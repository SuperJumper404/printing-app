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

## Notes

- Do not commit `settings.json`; it can contain local/private runtime data.
- The installed app checks for updates on startup.
- The Windows package requests administrator rights because printer access and auto-start can require elevated permissions.
