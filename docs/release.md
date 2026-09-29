# SmartEat Printer Agent release

The Windows app updates through GitHub Releases:

`https://github.com/SuperJumper404/printing-app/releases`

## Automatic release

1. Update the app version in `package.json`, for example `1.0.1`.
2. Commit the change.
3. Create and push a matching tag:

```powershell
git tag v1.0.1
git push origin main
git push origin v1.0.1
```

GitHub Actions installs dependencies, builds the Windows installer/portable files, then creates one GitHub release containing `latest.yml`, the installer, the installer blockmap, and the portable executable. `electron-updater` reads `latest.yml` from GitHub Releases.

## Manual local build

To create release files locally without publishing:

```powershell
npm.cmd run release:win
```

The files are written to `dist6/`.

Before packaging, run the complete automated verification:

```powershell
npm.cmd run verify
npm.cmd run release:win
```

## Thermal printer transports

The agent can discover and configure these independent ESC/POS routes:

- Windows RAW printer queue
- TCP 9100, IPP, LPR, and Epson ePOS HTTP
- USB or Bluetooth serial COM port
- Authorized WebUSB bulk OUT and WebHID output reports
- Authorized Bluetooth LE GATT characteristic

Every enabled route receives the ticket independently. A failure on one route is recorded without cancelling the other enabled routes.

Raw USB, HID, and Bluetooth GATT depend on the printer firmware, Windows ownership of the interface, and explicit user authorization. An automated adapter result does not replace a physical ticket check.

## Hardware acceptance matrix

Record the result for the release machine before publishing:

| Transport | Automated | Physical ticket |
| --- | --- | --- |
| Windows RAW USB | Sender boundary covered | Outstanding |
| TCP 9100 | Sender boundary covered | Outstanding |
| USB COM | Sender boundary covered | Outstanding |
| IPP | Sender boundary covered | Outstanding |
| Epson ePOS HTTP | Sender boundary covered | Outstanding |
| LPR | RFC 1179 dialogue covered | Outstanding |
| WebUSB bulk OUT | Endpoint and bridge covered | Outstanding |
| WebHID | Report chunking and bridge covered | Outstanding |
| Bluetooth COM | Sender boundary covered | Outstanding |
| Bluetooth LE GATT | Chunking, ordering, and bridge covered | Outstanding |

For a multi-send acceptance test, enable two transports on one printer, send one test ticket, and confirm two independent result rows. Confirm each physical output separately in the app.

## Notes

- Do not commit `settings.json`; it can contain local/private runtime data.
- The installed app checks for updates on startup.
- The Windows package requests administrator rights because printer access and auto-start can require elevated permissions.
