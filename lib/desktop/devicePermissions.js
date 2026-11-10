const { deviceMetadata, identityMatchesDevice, findUniqueMatchingDevice, isTrustedDeviceOrigin } = require("../printers/devicePermissions");

function configureDevicePermissions(window, { ipc, getGrants, saveGrant }) {
  const pending = new Map();
  let bluetooth = null;
  const contents = window.webContents;
  contents.session.setPermissionCheckHandler((_, permission, origin) => isTrustedDeviceOrigin(origin) && ["usb", "hid"].includes(permission));
  contents.session.setDevicePermissionHandler(details => isTrustedDeviceOrigin(details.origin) &&
    getGrants().some(grant => grant.deviceType === details.deviceType && identityMatchesDevice(grant, details.device)));
  const selected = (type, devices, callback, empty) => {
    const identity = pending.get(type); pending.delete(type);
    const device = identity && findUniqueMatchingDevice(devices, identity);
    if (!device) return callback(empty);
    saveGrant(type, deviceMetadata(type, device)); callback(device.deviceId);
  };
  contents.session.on("select-usb-device", (event, details, callback) => {
    event.preventDefault();
    if (!isTrustedDeviceOrigin(details.frame?.url || "")) return callback();
    selected("usb", details.deviceList, callback);
  });
  contents.session.on("select-hid-device", (event, details, callback) => {
    event.preventDefault();
    if (!isTrustedDeviceOrigin(details.frame?.url || "")) return callback(null);
    selected("hid", details.deviceList, callback, null);
  });
  contents.on("select-bluetooth-device", (event, devices, callback) => {
    event.preventDefault();
    if (!bluetooth) return callback("");
    bluetooth.callback = callback;
    const device = findUniqueMatchingDevice(devices, bluetooth.identity);
    if (!device) return;
    clearTimeout(bluetooth.timer); bluetooth = null;
    saveGrant("bluetooth", deviceMetadata("bluetooth", device)); callback(device.deviceId);
  });
  const intent = (event, request = {}) => {
    if (event.sender !== contents || !["usb", "hid", "bluetooth"].includes(request.deviceType) || !request.identity || typeof request.identity !== "object") return;
    if (request.deviceType !== "bluetooth") { pending.set(request.deviceType, request.identity); return; }
    if (bluetooth) { clearTimeout(bluetooth.timer); bluetooth.callback?.(""); }
    const entry = { identity: request.identity, callback: null };
    entry.timer = setTimeout(() => { if (bluetooth === entry) { bluetooth = null; entry.callback?.(""); } }, 30000);
    bluetooth = entry;
  };
  ipc.on("printer-device-selection-intent", intent);
  contents.once("destroyed", () => { ipc.off("printer-device-selection-intent", intent); pending.clear(); if (bluetooth) { clearTimeout(bluetooth.timer); bluetooth.callback?.(""); bluetooth = null; } });
}

module.exports = { configureDevicePermissions };
