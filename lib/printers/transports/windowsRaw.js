const { createPrintError, wrapTransportError } = require("../errors");

const RAW_PRINT_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public class SmartEatRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint="OpenPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterW", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern uint StartDocPrinter(IntPtr handle, uint level, [In] DOCINFOW info);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool AbortPrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

  private static Exception Failure(string operation, bool writing, int code) {
    string category = writing ? "WRITE_FAILED" : (code == 5 || code == 87 || code == 1801 || code == 1804 ? "CONFIGURATION" : "CONNECTION_FAILED");
    return new Win32Exception(code, "SMARTEAT_" + (writing ? "UNKNOWN:" : "NOT_SENT:") + category + " " + operation + " (Win32 " + code + "): " + new Win32Exception(code).Message);
  }
  public static void Send(string printerName, byte[] bytes) {
    IntPtr memory = IntPtr.Zero;
    IntPtr handle = IntPtr.Zero;
    bool document = false;
    bool writing = false;
    try {
      if (!OpenPrinter(printerName, out handle, IntPtr.Zero)) throw Failure("OpenPrinter", false, Marshal.GetLastWin32Error());
      var info = new DOCINFOW { pDocName = "SmartEat RAW Ticket", pDataType = "RAW" };
      uint jobId = StartDocPrinter(handle, 1, info);
      if (jobId == 0) throw Failure("StartDocPrinter", false, Marshal.GetLastWin32Error());
      document = true;
      if (!StartPagePrinter(handle)) throw Failure("StartPagePrinter", false, Marshal.GetLastWin32Error());
      memory = Marshal.AllocCoTaskMem(bytes.Length);
      Marshal.Copy(bytes, 0, memory, bytes.Length);
      int written;
      writing = true;
      if (!WritePrinter(handle, memory, bytes.Length, out written)) throw Failure("WritePrinter", true, Marshal.GetLastWin32Error());
      if (written != bytes.Length) throw new Exception("SMARTEAT_UNKNOWN:WRITE_FAILED Partial RAW write " + written + "/" + bytes.Length);
      if (!EndPagePrinter(handle)) throw Failure("EndPagePrinter", true, Marshal.GetLastWin32Error());
      if (!EndDocPrinter(handle)) throw Failure("EndDocPrinter", true, Marshal.GetLastWin32Error());
      document = false;
    } catch (Exception error) {
      if (error.Message.StartsWith("SMARTEAT_")) throw;
      throw new Exception("SMARTEAT_" + (writing ? "UNKNOWN:WRITE_FAILED " : "NOT_SENT:PRINT_FAILED ") + error.Message, error);
    } finally {
      if (document && handle != IntPtr.Zero) AbortPrinter(handle);
      if (handle != IntPtr.Zero) ClosePrinter(handle);
      if (memory != IntPtr.Zero) Marshal.FreeCoTaskMem(memory);
    }
  }
}
"@
try {
  $bytes = [Convert]::FromBase64String($env:SMARTEAT_PRINT_BASE64)
  [SmartEatRawPrinter]::Send($env:SMARTEAT_PRINTER_NAME, $bytes)
} catch {
  throw $_.Exception.GetBaseException().Message
}
`;

function createWindowsRawSender({ runPowerShell }) {
  return {
    async send({ transport, base64Data, signal }) {
      if (signal?.aborted) throw createPrintError("ABORTED");
      const config = transport?.config || {};
      if (!config.printerName) throw createPrintError("CONFIGURATION");
      const configuredTimeout = Number(config.timeoutMs);
      const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 15000;
      try {
        await runPowerShell(RAW_PRINT_SCRIPT, {
          SMARTEAT_PRINTER_NAME: config.printerName,
          SMARTEAT_PRINT_BASE64: base64Data,
        }, { timeoutMs, signal });
      } catch (error) { throw wrapTransportError(error); }
    },
  };
}

module.exports = { createWindowsRawSender };
