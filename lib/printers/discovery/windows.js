function buildWindowsDiscoveryScript() {
  return `
$rows = @()

try {
  $rows += @(Get-Printer -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{
      source = 'printerQueue'
      name = $_.Name
      printerName = $_.Name
      portName = $_.PortName
      driverName = $_.DriverName
      status = $_.PrinterStatus
      type = $_.Type
      shared = $_.Shared
    }
  })
} catch {}

try {
  $rows += @(Get-PrinterPort -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{
      source = 'printerPort'
      name = $_.Name
      description = $_.Description
      printerHostAddress = $_.PrinterHostAddress
      portNumber = $_.PortNumber
      protocol = $_.Protocol
      snmpEnabled = $_.SNMPEnabled
    }
  })
} catch {}

try {
  $pnpDevices = @(Get-PnpDevice -PresentOnly -ErrorAction Stop |
    Where-Object {
      $_.Class -in @('Printer', 'Ports', 'USB', 'USBDevice', 'HIDClass', 'Bluetooth') -or
      $_.InstanceId -match 'USBPRINT|VID_[0-9A-F]{4}&PID_[0-9A-F]{4}|^BTH'
    })
  $propertyLookup = @{}
  if ($pnpDevices.Count -gt 0) {
    try {
      $allProperties = Get-PnpDeviceProperty -InstanceId @($pnpDevices.InstanceId) -KeyName @(
        'DEVPKEY_Device_Parent',
        'DEVPKEY_Device_ContainerId',
        'DEVPKEY_Device_LocationInfo',
        'DEVPKEY_Device_LocationPaths',
        'DEVPKEY_Device_BusReportedDeviceDesc'
      ) -ErrorAction Stop
      foreach ($property in $allProperties) {
        $lookupKey = $property.InstanceId.ToUpperInvariant()
        if (-not $propertyLookup.ContainsKey($lookupKey)) {
          $propertyLookup[$lookupKey] = @{}
        }
        $propertyLookup[$lookupKey][$property.KeyName] = $property.Data
      }
    } catch {}
  }

  $rows += @($pnpDevices | ForEach-Object {
    $device = $_
    $properties = $propertyLookup[$device.InstanceId.ToUpperInvariant()]
    if ($null -eq $properties) { $properties = @{} }

    [pscustomobject]@{
      source = 'pnp'
      name = if ($properties['DEVPKEY_Device_BusReportedDeviceDesc']) { $properties['DEVPKEY_Device_BusReportedDeviceDesc'] } else { $device.FriendlyName }
      friendlyName = $device.FriendlyName
      className = $device.Class
      instanceId = $device.InstanceId
      parentInstanceId = $properties['DEVPKEY_Device_Parent']
      containerId = $properties['DEVPKEY_Device_ContainerId']
      locationInfo = $properties['DEVPKEY_Device_LocationInfo']
      locationPaths = $properties['DEVPKEY_Device_LocationPaths']
      status = $device.Status
      problem = $device.Problem
    }
  })
} catch {}

try {
  $rows += @(Get-CimInstance Win32_PnPEntity -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{
      source = 'pnpEntity'
      name = $_.Name
      className = $_.PNPClass
      instanceId = $_.PNPDeviceID
      manufacturer = $_.Manufacturer
      service = $_.Service
      status = $_.Status
    }
  })
} catch {}

try {
  $rows += @(Get-CimInstance Win32_SerialPort -ErrorAction Stop | ForEach-Object {
    [pscustomobject]@{
      source = 'serial'
      name = $_.Name
      deviceId = $_.DeviceID
      pnpDeviceId = $_.PNPDeviceID
      description = $_.Description
      providerType = $_.ProviderType
      status = $_.Status
    }
  })
} catch {}

@($rows) | ConvertTo-Json -Depth 6 -Compress
`;
}

function normalizeId(value) {
  return value ? String(value).trim() : null;
}

function parseHardwareIdentity(instanceId) {
  const value = String(instanceId || "");
  const vendorId = value.match(/VID[_&]([0-9A-F]{4})/i)?.[1]?.toUpperCase() || null;
  const productId = value.match(/PID[_&]([0-9A-F]{4})/i)?.[1]?.toUpperCase() || null;
  const parts = value.split("\\").filter(Boolean);
  const tail = parts.at(-1) || "";
  const serialNumber = tail && !tail.includes("&") ? tail : null;
  return { vendorId, productId, serialNumber };
}

function parseLocation(locationInfo) {
  const value = String(locationInfo || "");
  const portNumber = Number(value.match(/Port_#0*(\d+)/i)?.[1] || 0) || null;
  const hubNumber = Number(value.match(/Hub_#0*(\d+)/i)?.[1] || 0) || null;
  return portNumber || hubNumber ? { portNumber, hubNumber } : null;
}

function isNameAllowed(row, useFilters) {
  if (!useFilters) return true;
  const text = [row.name, row.friendlyName, row.description, row.instanceId]
    .filter(Boolean)
    .join(" ");
  return /print|pos|receipt|thermal|ticket|epson|tm-|star|zebra|bixolon|citizen|xprinter|xp-/i.test(text);
}

function createQueueObservation(row, port) {
  const address = normalizeId(port?.printerHostAddress);
  return {
    id: `queue:${row.printerName || row.name}`,
    observationId: `queue:${row.printerName || row.name}`,
    source: "windows-queue",
    name: row.name || row.printerName,
    printerName: row.printerName || row.name,
    portName: row.portName || null,
    driverName: row.driverName || null,
    status: row.status ?? null,
    addresses: address ? [address] : [],
    ip: address,
    transports: {
      windowsRaw: {
        available: true,
        enabled: false,
        verified: false,
        config: {
          printerName: row.printerName || row.name,
          portName: row.portName || null,
          driverName: row.driverName || null,
        },
        reason: null,
      },
    },
  };
}

function createSerialObservation(row) {
  const instanceId = normalizeId(row.pnpDeviceId || row.instanceId);
  const bluetooth = /BTH|Bluetooth/i.test(
    [instanceId, row.name, row.description].filter(Boolean).join(" "),
  );
  const transportId = bluetooth ? "bluetoothSerial" : "usbSerial";
  const portName = normalizeId(row.deviceId || row.portName)?.replace(/:$/, "") || null;
  return {
    id: `serial:${portName || instanceId}`,
    observationId: `serial:${portName || instanceId}`,
    source: bluetooth ? "bluetooth-serial" : "usb-serial",
    name: row.name || row.description || portName,
    portName,
    ...parseHardwareIdentity(instanceId),
    instanceIds: instanceId ? [instanceId] : [],
    transports: {
      [transportId]: {
        available: true,
        enabled: false,
        verified: false,
        config: {
          portName,
          baudRate: 9600,
          dataBits: 8,
          parity: "None",
          stopBits: 1,
        },
        reason: null,
      },
    },
  };
}

function createPnpObservation(row) {
  const instanceId = normalizeId(row.instanceId || row.pnpDeviceId);
  const className = String(row.className || "");
  const description = [instanceId, className, row.name, row.friendlyName]
    .filter(Boolean)
    .join(" ");
  let transportId = null;
  if (/BTH|Bluetooth/i.test(description)) transportId = "bluetoothGatt";
  else if (/^HID\\|HIDClass/i.test(description)) transportId = "usbHid";
  else if (/USBPRINT|^USB\\|\bPrinter\b|\bUSBDevice\b|^USB$/i.test(description)) {
    transportId = "usbRaw";
  }
  if (!transportId) return null;

  const parentInstanceId = normalizeId(row.parentInstanceId);
  return {
    id: `pnp:${instanceId}`,
    observationId: `pnp:${instanceId}`,
    source: "windows-pnp",
    name: row.name || row.friendlyName || instanceId,
    manufacturer: row.manufacturer || null,
    className: row.className || null,
    status: row.status ?? null,
    ...parseHardwareIdentity(instanceId),
    containerId: normalizeId(row.containerId),
    instanceIds: instanceId ? [instanceId] : [],
    parentInstanceIds: parentInstanceId ? [parentInstanceId] : [],
    location: parseLocation(row.locationInfo),
    locationPaths: Array.isArray(row.locationPaths)
      ? row.locationPaths
      : row.locationPaths
        ? [row.locationPaths]
        : [],
    transports: {
      [transportId]: {
        available: true,
        enabled: false,
        verified: false,
        config: {
          vendorId: parseHardwareIdentity(instanceId).vendorId,
          productId: parseHardwareIdentity(instanceId).productId,
          serialNumber: parseHardwareIdentity(instanceId).serialNumber,
        },
        reason: "Autorisation utilisateur requise avant l'envoi direct",
      },
    },
  };
}

function normalizeWindowsDiscoveryRows(rows = [], { useFilters = false } = {}) {
  const ports = new Map(
    rows
      .filter((row) => row?.source === "printerPort" && row.name)
      .map((row) => [String(row.name).toUpperCase(), row]),
  );
  const pnpRowsById = new Map();
  for (const row of rows.filter((item) => item?.source === "pnp")) {
    if (row.instanceId) pnpRowsById.set(String(row.instanceId).toUpperCase(), row);
  }

  const observations = [];
  for (const row of rows) {
    if (!row || !isNameAllowed(row, useFilters)) continue;

    if (row.source === "printerQueue") {
      observations.push(
        createQueueObservation(row, ports.get(String(row.portName || "").toUpperCase())),
      );
    } else if (row.source === "serial") {
      observations.push(createSerialObservation(row));
    } else if (row.source === "pnp") {
      const observation = createPnpObservation(row);
      if (observation) observations.push(observation);
    } else if (row.source === "pnpEntity") {
      const key = String(row.instanceId || "").toUpperCase();
      if (!pnpRowsById.has(key)) {
        const observation = createPnpObservation(row);
        if (observation) observations.push(observation);
      }
    }
  }

  return observations;
}

async function discoverWindowsPrinterObservations(
  runPowerShellJson,
  options = {},
) {
  const rows = await runPowerShellJson(buildWindowsDiscoveryScript());
  return normalizeWindowsDiscoveryRows(rows, options);
}

module.exports = {
  buildWindowsDiscoveryScript,
  discoverWindowsPrinterObservations,
  normalizeWindowsDiscoveryRows,
};
