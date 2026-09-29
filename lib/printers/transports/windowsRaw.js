const RAW_PRINT_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SmartEatRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }

  [DllImport("winspool.Drv", EntryPoint="OpenPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.Drv", EntryPoint="StartDocPrinterA", SetLastError=true, CharSet=CharSet.Ansi)]
  public static extern bool StartDocPrinter(IntPtr handle, int level, [In] DOCINFOA info);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)] public static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.Drv", SetLastError=true)]
  public static extern bool WritePrinter(IntPtr handle, IntPtr bytes, int count, out int written);

  public static bool Send(string printerName, byte[] bytes) {
    IntPtr memory = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, memory, bytes.Length);
    IntPtr handle;
    int written;
    bool success = false;
    try {
      if (OpenPrinter(printerName.Normalize(), out handle, IntPtr.Zero)) {
        var info = new DOCINFOA { pDocName = "SmartEat RAW Ticket", pDataType = "RAW" };
        if (StartDocPrinter(handle, 1, info)) {
          if (StartPagePrinter(handle)) {
            success = WritePrinter(handle, memory, bytes.Length, out written) && written == bytes.Length;
            EndPagePrinter(handle);
          }
          EndDocPrinter(handle);
        }
        ClosePrinter(handle);
      }
    } finally {
      Marshal.FreeCoTaskMem(memory);
    }
    return success;
  }
}
"@
$bytes = [Convert]::FromBase64String($env:SMARTEAT_PRINT_BASE64)
$ok = [SmartEatRawPrinter]::Send($env:SMARTEAT_PRINTER_NAME, $bytes)
if (-not $ok) { throw "Impossible d'envoyer le ticket RAW a la file Windows." }
`;

function createWindowsRawSender({ runPowerShell }) {
  return {
    async send({ transport, base64Data }) {
      const printerName = transport?.config?.printerName;
      if (!printerName) throw new Error("Nom de file Windows manquant");
      await runPowerShell(RAW_PRINT_SCRIPT, {
        SMARTEAT_PRINTER_NAME: printerName,
        SMARTEAT_PRINT_BASE64: base64Data,
      });
    },
  };
}

module.exports = { createWindowsRawSender };
