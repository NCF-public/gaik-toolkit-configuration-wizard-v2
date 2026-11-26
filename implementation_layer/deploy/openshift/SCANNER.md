# Upload malware check

Every file a person uploads (a case input, a PoC sample input) goes through three
checks in the api before it is stored. A file that fails any of them is never
written to the sessions volume.

1. **What the file is**, from its bytes (`services/input_content.py`). Only the
   types the session's input contract names are accepted (PDF, PNG, JPEG, GIF,
   WebP, TIFF, WAV, MP3, M4A, TXT, MD, CSV, JSON, DOCX, XLSX), and the extension
   must match the content.
2. **What the document carries** (`services/input_content.py`,
   `services/pdf_content.py`). Refused: DOCX and XLSX files with macros or
   ActiveX controls, and PDF files with JavaScript, launch or import-data
   actions, or rich media, also inside compressed object streams. An encrypted
   PDF with object streams is refused because its content cannot be read.
3. **Malware**, by a malware scanner (`services/malware_scan.py`). ClamAV,
   run by `deployment-scanner.yaml`, is the default; another scanner can be
   named instead (see "Use another scanner"). Known malware is refused, and so are files with
   macros, encrypted files ClamAV cannot open (a PDF with a user password, an
   encrypted archive), and files over its scan limits.

Refusals answer `422 input_unsafe` with our own words. The signature name goes
to the api log, not to the person.

## Fails closed

With `WIZARD_MALWARE_SCANNER` set, scanning is required. When the scanner does
not answer, times out (60 s) or gives no verdict, the upload is refused with
`503 scanner_unavailable` and nothing is stored. `WIZARD_MALWARE_SCAN=off`
turns the scan off. The `wizard_config_malware_scan` gauge is then 0, and the
`WizardUploadsNotScanned` alert shows it.

## Deploy

```bash
PROJECT=<project> INSTANCE=s4 ./deploy.sh scanner
oc set env deployment/wizard-v2-s4-api -c wizard-v2-s4-api WIZARD_MALWARE_SCANNER=wizard-v2-s4-scanner:3310
```

`./deploy.sh scanner` builds the image (the current signatures are downloaded
into it), pushes it, applies `deployment-scanner.yaml` and rolls it out. It does
not touch the api or web Deployments. Set the api's variable with `oc set env`,
not by applying `deployment-api.yaml`.

- **Signatures:** freshclam checks for updates twelve times a day from
  `database.clamav.net`, so the scanner pod needs outbound HTTPS. If updates do
  not get through, it keeps scanning with what it has, and
  `WizardMalwareSignaturesStale` fires after two days.
- **Memory:** about 1 GiB with the signatures loaded. The limit is 3 GiB
  because clamd loads an update next to the old set.
- **Network:** the scanner accepts connections on 3310. Sandbox runs cannot
  reach it, because their policy (`networkpolicy-sandbox.yaml`) allows only the
  api and public addresses. The namespace's own policies currently let other
  pods in the namespace connect too.

## Use another scanner

`WIZARD_MALWARE_SCANNER` names the scanner the api asks:

| Value | Scanner |
| --- | --- |
| `host:port` or `clamd://host:port` | ClamAV's clamd (INSTREAM), the default; port 3310 |
| `icap://host[:port]/service` | a scanner that speaks ICAP (RFC 3507), as most commercial antivirus servers do; port 1344 |

```bash
oc set env deployment/wizard-v2-s4-api -c wizard-v2-s4-api WIZARD_MALWARE_SCANNER=icap://av.example.org:1344/avscan
```

The service path is the one the product names for scanning (for example
`/avscan`, `/av/respmod`). The api sends the file in a RESPMOD request that
allows a `204` answer:

- `204`: clean, the file is stored.
- `200` with `X-Infection-Found`, `X-Virus-ID`, `X-Violations-Found` or
  `X-Virus-Name`, or with an HTTP error page in place of the file: refused,
  `422 input_unsafe`; the threat name goes to the log.
- Anything else (an unchanged copy of the file, an ICAP error, no answer in
  60 s): no verdict, `503 scanner_unavailable`, nothing stored.

The `wizard_malware_scanner_up` gauge asks an ICAP scanner with `OPTIONS`.
ICAP gives no signature date, so `wizard_malware_scanner_signatures_age` stays
empty and `WizardMalwareSignaturesStale` does not fire; the scanner's own
monitoring covers its updates. A scanner outside the namespace needs an egress
rule for its port, and the file leaves the namespace: that is the customer's
decision as the data controller.

## What it does not cover

- Image files are matched against ClamAV's signatures; they are not decoded and
  re-encoded.
- A PDF whose names are hidden by a filter the check does not decode (Crypt, or
  an unknown one) is read only as far as its plain parts.
- ClamAV finds known malware and the patterns its heuristics name, not a new
  exploit for a parser.

## Metrics and alerts

| Metric | What it shows |
| --- | --- |
| `wizard_uploads_scanned_total{result}` | clean, refused, unavailable |
| `wizard_malware_scanner_up` | 1 while clamd answers a PING |
| `wizard_malware_scanner_signatures_age` | age of the loaded signatures in seconds |
| `wizard_config_malware_scan` | 1 while scanning is required |

Alerts are in `gaik-aiops/deploy/compose/prometheus/rules/wizard-alerts.yml`.
