# NET//OPS — Network Information Dashboard

A local, educational network diagnostics dashboard featuring:
- Connection and browser telemetry
- IP/hostname ping using the server's `ping` utility
- Browser download sample speed test
- DNS lookup (A/AAAA results returned by the server resolver)
- HTTPS response and common security-header review
- Hacker-style command console (dashboard commands only; not an OS shell)
- Charts and persistent history stored in `data/history.json`

## Requirements
- Node.js 18+
- npm
- A system `ping` utility available on PATH for IP pinging

## Run locally
1. Extract this folder.
2. Open a terminal in the project directory.
3. Run `npm install`
4. Run `npm start`
5. Visit http://localhost:3000

## Console commands
- `help`
- `status`
- `ping 1.1.1.1`
- `dns example.com`
- `history`
- `clear`

## Important limitations
- Ping is executed from the machine running Node.js, not necessarily from the browser device.
- ICMP may be blocked; no ping response does not prove a host is offline.
- The speed test is a small browser download sample and is not a certified ISP speed test.
- DNS uses the server's resolver, which may differ from the device's DNS.
- Header inspection checks a public HTTPS URL using a HEAD request. Missing headers are informational, not a definitive vulnerability finding.
- Private, loopback, and reserved IP targets are blocked for ping and HTTPS inspection. Use this only on systems and networks you are authorized to test.
- This is an educational starter project, not a production-hardened security scanner. Do not expose the server to the public internet without adding authentication, rate limits, stronger SSRF protections, and deployment security controls.

## Persistence
API checks are saved in `data/history.json` (up to 300 recent records). The file is created automatically on first run.
