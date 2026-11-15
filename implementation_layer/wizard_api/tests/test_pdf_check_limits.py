"""The upload checks take bounded time, and a PDF stream they cannot read is refused.

Every file here is generated; none of them does anything when opened.
"""

from __future__ import annotations

import asyncio
import socket
import threading
import time
import zlib

import pytest
from wizard_api.services import malware_scan, pdf_content

_JS_ACTION = b"<< /S /JavaScript /JS (app.alert(1)) >>"
#: Seconds a check may take here; a few hundredths are typical. Generous for CI.
_LIMIT = 3.0


def _pdf(objects: bytes = b"") -> bytes:
    return (
        b"%PDF-1.7\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\n"
        + objects
        + b"trailer\n<< /Root 1 0 R >>\n%%EOF\n"
    )


def _stream(num: int, dictionary: bytes, data: bytes) -> bytes:
    return (
        f"{num} 0 obj\n<< ".encode()
        + dictionary
        + f" /Length {len(data)} >>\nstream\n".encode()
        + data
        + b"\nendstream\nendobj\n"
    )


def _object_stream(extra: bytes, data: bytes) -> bytes:
    return _stream(9, b"/Type /ObjStm /N 1 /First 4 " + extra, data)


def _outcome(data: bytes) -> str:
    """What the check says, and that it said it within the time limit."""
    started = time.perf_counter()
    try:
        pdf_content.check(data)
        outcome = "accepted"
    except pdf_content.TooComplexError:
        outcome = "too complex"
    except pdf_content.ActiveContentError:
        outcome = "refused"
    elapsed = time.perf_counter() - started
    assert elapsed < _LIMIT, f"the check took {elapsed:.1f} s"
    return outcome


# ---------------------------------------------------------------------------
# Time
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("run", [b"7" * 20_000, b"7 " * 20_000, b"7\n" * 20_000])
def test_long_runs_of_numbers_are_checked_in_time(run):
    # As text outside streams, in an unencoded stream, and after /JS in a compressed one.
    page = _stream(6, b"", run)
    packed = _stream(7, b"/Filter /FlateDecode", zlib.compress(b"/JS " + run))
    assert _outcome(_pdf(run + page + packed)) == "accepted"


@pytest.mark.parametrize("piece", [b"stream\n", b"stream\nendstream\n", b"1 0 obj\nstream\n"])
def test_a_file_made_of_stream_keywords_is_checked_in_time(piece):
    assert _outcome(_pdf(piece * 300_000)) in {"accepted", "too complex"}


def test_streams_whose_lengths_overlap_are_refused_in_time():
    overlapping = b"".join(
        _stream(10 + n, b"/Filter /FlateDecode /Length 99999999", b"x") for n in range(2_000)
    )
    assert _outcome(_pdf(overlapping)) == "too complex"


def _lzw_codes(codes: list[int], width: int = 9) -> bytes:
    bits = nbits = 0
    out = bytearray()
    for code in codes:
        bits = (bits << width) | code
        nbits += width
        while nbits >= 8:
            nbits -= 8
            out.append((bits >> nbits) & 0xFF)
        bits &= (1 << nbits) - 1
    if nbits:
        out.append((bits << (8 - nbits)) & 0xFF)
    return bytes(out)


def test_a_long_lzw_stream_decodes_in_linear_time():
    # 200,000 clear-table codes, then "hi" and the end code.
    data = _lzw_codes([256] * 200_000 + [104, 105, 257])
    started = time.perf_counter()
    assert pdf_content._lzw(data, pdf_content._Budget()) == b"hi"
    assert time.perf_counter() - started < _LIMIT


# ---------------------------------------------------------------------------
# Streams the check cannot read
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("filters", [b"5 0 R", b"[5 0 R]", b"[/FlateDecode 5 0 R]"])
def test_a_filter_given_by_reference_is_refused(filters):
    named = b"5 0 obj\n/FlateDecode\nendobj\n"
    hidden = _object_stream(b"/Filter " + filters, zlib.compress(b"10 0 " + _JS_ACTION))
    assert _outcome(_pdf(named + hidden)) == "too complex"


@pytest.mark.parametrize(
    "parms", [b"<< /Predictor 12 /Columns 4 >>", b"8 0 R", b"[8 0 R]", b"[<< /Predictor 2 >>]"]
)
def test_an_object_stream_with_a_predictor_is_refused(parms):
    hidden = _object_stream(
        b"/Filter /FlateDecode /DecodeParms " + parms, zlib.compress(b"10 0 " + _JS_ACTION)
    )
    assert _outcome(_pdf(hidden)) == "too complex"


def test_a_cross_reference_stream_with_a_predictor_is_accepted():
    xref = _stream(
        9,
        b"/Type /XRef /W [1 2 1] /Size 4 /Filter /FlateDecode"
        b" /DecodeParms << /Predictor 12 /Columns 4 >>",
        zlib.compress(b"\x02\x01\x00\x10\x00" * 4),
    )
    assert _outcome(_pdf(xref)) == "accepted"


@pytest.mark.parametrize("parms", [b"<< /Predictor 1 >>", b"null"])
def test_decode_parameters_without_a_predictor_are_read(parms):
    hidden = _object_stream(
        b"/Filter /FlateDecode /DecodeParms " + parms, zlib.compress(b"10 0 " + _JS_ACTION)
    )
    assert _outcome(_pdf(hidden)) == "refused"


# ---------------------------------------------------------------------------
# Streams read as a viewer reads them
# ---------------------------------------------------------------------------


def test_a_wrong_length_does_not_hide_the_stream_after_it():
    first = b"6 0 obj\n<< /Length 99999999 >>\nstream\nq Q\nendstream\nendobj\n"
    hidden = _object_stream(b"/Filter /FlateDecode", zlib.compress(b"10 0 " + _JS_ACTION))
    assert _outcome(_pdf(first + hidden)) == "refused"


def test_an_endstream_inside_compressed_data_does_not_cut_it_short():
    # Stored deflate blocks keep their bytes as written, so "endstream" stands in the data.
    body = b"endstream " + b"10 0 " + _JS_ACTION
    hidden = _object_stream(b"/Filter /FlateDecode", zlib.compress(body, 0))
    assert b"endstream " in zlib.compress(body, 0)
    assert _outcome(_pdf(hidden)) == "refused"


def test_text_in_a_stream_is_not_read_as_streams_of_its_own():
    page = _stream(6, b"", b"(stream) Tj\nstream\nendstream text\n")
    data = _pdf(page + _stream(7, b"/Filter /FlateDecode", zlib.compress(b"q Q")))
    assert len(list(pdf_content._streams(data, pdf_content._Budget()))) == 2
    assert _outcome(data) == "accepted"


def test_the_existing_kinds_of_encoded_object_streams_are_still_read():
    for filters, encode in [
        (b"/FlateDecode", zlib.compress),
        (b"[/ASCIIHexDecode /FlateDecode]", lambda d: zlib.compress(d).hex().encode() + b">"),
    ]:
        hidden = _object_stream(b"/Filter " + filters, encode(b"10 0 " + _JS_ACTION))
        assert _outcome(_pdf(hidden)) == "refused", filters


# ---------------------------------------------------------------------------
# The scanner
# ---------------------------------------------------------------------------


def test_a_scan_that_times_out_does_not_wait_for_the_scanner(monkeypatch):
    server = socket.create_server(("127.0.0.1", 0))
    connections: list[socket.socket] = []

    def accept() -> None:
        connection, _ = server.accept()
        connections.append(connection)  # never read: the upload fills the buffers
        time.sleep(10)
        connection.close()

    threading.Thread(target=accept, daemon=True).start()
    monkeypatch.setenv("WIZARD_MALWARE_SCANNER", f"127.0.0.1:{server.getsockname()[1]}")
    monkeypatch.delenv("WIZARD_MALWARE_SCAN", raising=False)
    monkeypatch.setattr(malware_scan, "SCAN_TIMEOUT_SECONDS", 0.5)
    started = time.monotonic()
    try:
        with pytest.raises(malware_scan.ScannerUnavailableError):
            asyncio.run(malware_scan.check_upload(b"x" * (48 * 1024 * 1024)))
        assert time.monotonic() - started < _LIMIT
    finally:
        server.close()
