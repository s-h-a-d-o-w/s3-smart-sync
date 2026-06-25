call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
cl.exe bootstrap.cpp /Fe:dist/s3-smart-sync.exe /link /SUBSYSTEM:WINDOWS
del bootstrap.obj