"""PDF files that carry actions a viewer would run are refused.

ClamAV (``malware_scan``) reports known malware but passes a PDF that runs
JavaScript when it is opened. Nothing in the wizard runs a PDF's actions (the
parsers read text and images), but the file is also handed to the sandbox run's
parsers and downloaded again by the person, so a PDF that names any of these is
refused:

- a JavaScript action (``/S /JavaScript``), a ``/JS`` script or the document's
  ``/JavaScript`` name tree
- a launch action (``/S /Launch``), which opens another file or program
- an import-data action (``/S /ImportData``)
- rich media (``/Subtype /RichMedia``), embedded Flash or video with scripts

Where the names may be: in the file as written, and inside its streams, since
PDF 1.5 keeps most objects in compressed object streams. Every stream that is
not an image is decoded (Flate, LZW, ASCIIHex, ASCII85, RunLength, chained) up
to a budget for the whole file; a file over it is refused as too complex to
check. Names written with ``#xx`` escapes and comments between tokens are read
as a viewer reads them.

An encrypted PDF keeps its streams encrypted. Its dictionaries outside streams
are still plain, so such a file is checked as far as that goes, and refused
when it also has object streams, where the checked names could hide. A PDF with
a user password is refused by the scanner.

A stream whose decoding cannot be established from its own dictionary (a
filter or its parameters given by reference, or a predictor on a stream that is
not an image or a cross-reference stream) is refused as too complex to check.
"""

from __future__ import annotations

import base64
import bisect
import re
import zlib

#: Bytes the check reads beyond the file itself: decoded stream data and the
#: stream dictionaries it looks up. Images are not decoded; text, fonts and
#: object streams of a 50 MB document stay far below this.
MAX_DECODED_BYTES = 256 * 1024 * 1024
_OUT_CHUNK = 1024 * 1024
#: How far back from a stream's data its dictionary may start.
_DICT_LOOKBACK = 16 * 1024


class ActiveContentError(ValueError):
    """The PDF names an action or content we refuse; the message is for the person."""


class TooComplexError(ValueError):
    """The PDF decodes to more than the check reads."""


_DELIM = rb"\x00\t\n\x0c\r /\[\]()<>{}%"
_END = rb"(?=[" + _DELIM + rb"]|$)"
# Whitespace and comments, which may stand between any two tokens. Possessive:
# what follows is never whitespace or a comment, so nothing is given back, and a
# line ending or a "%" inside a comment cannot be split two ways.
_WS = rb"(?:[\x00\t\n\x0c\r ]++|%[^\r\n]*+)*+"
# Object and generation numbers: bounded, and always a whole run of digits, so
# matching stays linear in the size of the file.
_OBJ_NUM = rb"(?<![0-9])[0-9]{1,10}(?![0-9])"
_GEN_NUM = rb"(?<![0-9])[0-9]{1,5}(?![0-9])"
_REF = _OBJ_NUM + _WS + _GEN_NUM + _WS + rb"R" + _END
_REF_OR_VALUE = rb"(?:<<|[(<\[]|" + _REF + rb")"

_FINDINGS: tuple[tuple[re.Pattern[bytes], str], ...] = (
    (re.compile(rb"/S" + _WS + rb"/JavaScript" + _END), "JavaScript"),
    (re.compile(rb"/JS" + _WS + _REF_OR_VALUE), "JavaScript"),
    (
        re.compile(rb"/JavaScript" + _WS + rb"(?:<<|" + _REF + rb")"),
        "JavaScript",
    ),
    (re.compile(rb"/S" + _WS + rb"/Launch" + _END), "an action that opens another file"),
    (re.compile(rb"/S" + _WS + rb"/ImportData" + _END), "an action that imports data"),
    (re.compile(rb"/Subtype" + _WS + rb"/RichMedia" + _END), "embedded rich media"),
)

_HEX_ESCAPE = re.compile(rb"#([0-9A-Fa-f]{2})")
# The keyword, not the end of "endstream".
_STREAM = re.compile(rb"(?<![A-Za-z])stream(?:\r\n|\n|\r)")
_OBJ = re.compile(_OBJ_NUM + _WS + _GEN_NUM + _WS + rb"obj" + _END)
_NAME = re.compile(rb"/([^" + _DELIM + rb"]*)")
_LENGTH = re.compile(rb"/Length" + _WS + rb"([0-9]{1,12})(?![0-9])" + _WS + rb"(?=/|>>)")
_FILTER_KEY = re.compile(rb"/Filter" + _END)
_FILTER = re.compile(rb"/Filter" + _WS + rb"(\[[^\]]*\]|/[^" + _DELIM + rb"]*|null" + _END + rb")")
# A filter array the check can read: names only, no references.
_NAME_ARRAY = re.compile(rb"\[(?:" + _WS + rb"/[^" + _DELIM + rb"]*+)*+" + _WS + rb"\]")
_DECODE_PARMS = re.compile(rb"/DecodeParms" + _END + _WS)
_PREDICTOR = re.compile(rb"/Predictor" + _WS + rb"([0-9]{1,3})(?![0-9])")
_XREF_TYPE = re.compile(rb"/Type" + _WS + rb"/XRef" + _END)

_IMAGE_CODECS = frozenset(
    {b"DCTDecode", b"DCT", b"JPXDecode", b"CCITTFaxDecode", b"CCF", b"JBIG2Decode"}
)


def _unescape(buf: bytes) -> bytes:
    return _HEX_ESCAPE.sub(lambda m: bytes([int(m.group(1), 16)]), buf) if b"#" in buf else buf


def _findings(buf: bytes) -> str | None:
    text = _unescape(buf)
    for pattern, what in _FINDINGS:
        if pattern.search(text):
            return what
    return None


class _Budget:
    def __init__(self) -> None:
        self.left = MAX_DECODED_BYTES

    def take(self, n: int) -> None:
        self.left -= n
        if self.left < 0:
            raise TooComplexError("the PDF is too complex to be checked")


# ------------------------------------------------------------------ decoders


def _flate(data: bytes, budget: _Budget) -> bytes:
    decomp = zlib.decompressobj()
    out = bytearray()
    try:
        piece = decomp.decompress(data, _OUT_CHUNK)
        while True:
            budget.take(len(piece))
            out += piece
            if not decomp.unconsumed_tail:
                break
            piece = decomp.decompress(decomp.unconsumed_tail, _OUT_CHUNK)
    except zlib.error:
        pass  # what decoded before the damage is still read
    return bytes(out)


def _ascii_hex(data: bytes, budget: _Budget) -> bytes:
    digits = re.sub(rb"[^0-9A-Fa-f]", b"", data.split(b">", 1)[0])
    if len(digits) % 2:
        digits += b"0"
    budget.take(len(digits) // 2)
    return bytes.fromhex(digits.decode("ascii"))


def _ascii85(data: bytes, budget: _Budget) -> bytes:
    body = data.split(b"~>", 1)[0]
    body = re.sub(rb"[\x00\t\n\x0c\r ]", b"", body)
    if body.startswith(b"<~"):
        body = body[2:]
    budget.take(len(body) * 4 + body.count(b"z") * 4)
    try:
        return base64.a85decode(body, foldspaces=False, adobe=False)
    except ValueError:
        return b""


def _run_length(data: bytes, budget: _Budget) -> bytes:
    out = bytearray()
    i = 0
    while i < len(data):
        n = data[i]
        if n == 128:
            break
        if n < 128:
            piece = data[i + 1 : i + 2 + n]
            i += 2 + n
        else:
            piece = data[i + 1 : i + 2] * (257 - n)
            i += 2
        budget.take(len(piece))
        out += piece
    return bytes(out)


def _lzw(data: bytes, budget: _Budget, early: int = 1) -> bytes:
    out = bytearray()
    table: list[bytes] = [bytes([i]) for i in range(256)] + [b"", b""]
    width, bits, nbits, prev = 9, 0, 0, b""
    for byte in data:
        bits = (bits << 8) | byte
        nbits += 8
        while nbits >= width:
            nbits -= width
            code = (bits >> nbits) & ((1 << width) - 1)
            bits &= (1 << nbits) - 1  # keep only the bits not read yet
            if code == 256:
                table = table[:258]
                width, prev = 9, b""
                continue
            if code == 257:
                return bytes(out)
            if code < len(table):
                entry = table[code]
                if prev:
                    table.append(prev + entry[:1])
            elif prev:
                entry = prev + prev[:1]
                table.append(entry)
            else:
                return bytes(out)
            budget.take(len(entry))
            out += entry
            prev = entry
            if len(table) + early >= (1 << width) and width < 12:
                width += 1
    return bytes(out)


_DECODERS = {
    b"FlateDecode": _flate,
    b"Fl": _flate,
    b"ASCIIHexDecode": _ascii_hex,
    b"AHx": _ascii_hex,
    b"ASCII85Decode": _ascii85,
    b"A85": _ascii85,
    b"RunLengthDecode": _run_length,
    b"RL": _run_length,
    b"LZWDecode": _lzw,
    b"LZW": _lzw,
}


# ------------------------------------------------------------------ streams


def _stream_dict(data: bytes, start: int, obj_ends: list[int]) -> bytes:
    """The bytes between the stream's ``N G obj`` and its ``stream`` keyword.

    ``obj_ends`` holds where each ``N G obj`` of the file ends, in order, so the
    file is searched for them once rather than once per stream.
    """
    low = max(0, start - _DICT_LOOKBACK)
    last = bisect.bisect_right(obj_ends, start) - 1
    if last >= 0 and obj_ends[last] > low:
        low = obj_ends[last]
    return data[low:start]


def _not_checkable() -> TooComplexError:
    return TooComplexError("the PDF is too complex to be checked")


def _filters(stream_dict: bytes) -> list[bytes]:
    """The stream's filters by name; [] when it has none.

    Raises ``TooComplexError`` when its dictionary does not name them itself (a
    filter given by reference): a viewer would decode the stream, the check could
    not.
    """
    if not _FILTER_KEY.search(stream_dict):
        return []
    found = _FILTER.search(stream_dict)
    if not found:
        raise _not_checkable()
    value = found.group(1)
    if value.startswith(b"null"):
        return []  # a null entry is the same as none
    if value.startswith(b"[") and not _NAME_ARRAY.fullmatch(value):
        raise _not_checkable()
    return [name for name in _NAME.findall(value) if name]


def _has_predictor(stream_dict: bytes) -> bool:
    """Whether the stream's decoded data is further transformed by a predictor.

    True also when the decode parameters are given by reference, so the check
    cannot tell.
    """
    parms = _DECODE_PARMS.search(stream_dict)
    if not parms:
        return False
    rest = stream_dict[parms.end() :]
    if rest.startswith(b"null"):
        return False
    if not rest.startswith((b"<<", b"[")):
        return True  # by reference
    if rest.startswith(b"[") and re.search(_REF, rest.split(b"]", 1)[0]):
        return True
    return any(int(m.group(1)) > 1 for m in _PREDICTOR.finditer(stream_dict))


def _is_object_stream(stream_dict: bytes) -> bool:
    # A viewer reads an object stream by /N and /First, whatever else its
    # dictionary claims.
    return bool(
        re.search(rb"/First" + _END, stream_dict) or re.search(rb"/N" + _WS + rb"\d", stream_dict)
    )


def _is_image(stream_dict: bytes) -> bool:
    # An object stream is decoded whatever else its dictionary claims: a viewer
    # reads it by /N and /First, which no image has.
    if _is_object_stream(stream_dict):
        return False
    return bool(re.search(rb"/Subtype" + _WS + rb"/Image" + _END, stream_dict))


def _decode(raw: bytes, filters: list[bytes], budget: _Budget) -> bytes | None:
    data = raw
    for name in filters:
        if name in _IMAGE_CODECS:
            return None
        decoder = _DECODERS.get(name)
        if decoder is None:  # Crypt or a filter we do not know: opaque to us
            return None
        data = decoder(data, budget)
    return data


def _streams(data: bytes, budget: _Budget):
    """Each stream's dictionary and the span of its raw data, in file order.

    Every ``stream`` keyword is read, also one inside another stream's data or in
    a dictionary's string or comment: the check does not tell them apart, so it
    skips none of them. The data runs for the stream's ``/Length``, or to the next
    ``endstream`` without one. The dictionaries count against ``budget``, so a
    file made of many ``stream`` keywords costs what its dictionaries cost.
    """
    obj_ends = [match.end() for match in _OBJ.finditer(data)]
    next_endstream = -2  # not looked up yet; -1 when none is left
    for match in _STREAM.finditer(data):
        start = match.end()
        raw_dict = _stream_dict(data, match.start(), obj_ends)
        budget.take(len(raw_dict))
        stream_dict = _unescape(raw_dict)
        # The keywords come in file order, so the endstream found for an earlier
        # one is still the next one unless this stream starts after it.
        if next_endstream != -1 and next_endstream < start:
            next_endstream = data.find(b"endstream", start)
        endstream = len(data) if next_endstream == -1 else next_endstream
        length = _LENGTH.search(stream_dict)
        end = min(len(data), start + int(length.group(1))) if length else endstream
        yield stream_dict, start, end


def check(data: bytes) -> None:
    """Raise ``ActiveContentError`` or ``TooComplexError``; return for a plain PDF."""
    what = _findings(data)
    if what:
        raise ActiveContentError(f"PDF files that contain {what} are not accepted")
    plain = _unescape(data)
    if re.search(rb"/Encrypt" + _END, plain) and re.search(rb"/ObjStm" + _END, plain):
        raise ActiveContentError(
            "encrypted PDF files whose content cannot be checked are not accepted; "
            "upload an unprotected copy"
        )
    budget = _Budget()
    # The raw data of a well-formed file's streams does not overlap, so what is
    # decoded never adds up to more than the file.
    raw_left = len(data)
    for stream_dict, start, end in _streams(data, budget):
        if _is_image(_unescape(stream_dict)):
            continue
        filters = [_unescape(f) for f in _filters(stream_dict)]
        if not filters:
            continue  # unencoded: already read with the file
        # A predictor reorders the decoded bytes; a cross-reference stream holds
        # only offsets, which a viewer does not read as objects.
        if _has_predictor(stream_dict) and (
            _is_object_stream(stream_dict) or not _XREF_TYPE.search(stream_dict)
        ):
            raise _not_checkable()
        raw_left -= end - start
        if raw_left < 0:
            raise _not_checkable()
        decoded = _decode(data[start:end], filters, budget)
        if decoded:
            what = _findings(decoded)
            if what:
                raise ActiveContentError(f"PDF files that contain {what} are not accepted")
