Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")

ScriptDir = FSO.GetParentFolderName(WScript.ScriptFullName)
NodePath = "node.exe"
AgentScript = FSO.BuildPath(ScriptDir, "agent-standalone.js")

' 0 = hide window, False = don't wait for return
WshShell.Run """" & NodePath & """ """ & AgentScript & """", 0, False
