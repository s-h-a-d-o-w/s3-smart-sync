#include <windows.h>
#include <string>

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance, LPSTR lpCmdLine, int nCmdShow) {
    STARTUPINFO si = {sizeof(si)};
    PROCESS_INFORMATION pi;
    si.dwFlags = STARTF_USESHOWWINDOW;
    si.wShowWindow = SW_HIDE;

    // Create mutable char arrays for the command
    char executablePath[] = "node.exe";

    // Combine base command with any additional arguments
    std::string fullCommand = "node.exe index.js ";
    fullCommand += lpCmdLine;
    char* commandLine = new char[fullCommand.length() + 1];
    strcpy(commandLine, fullCommand.c_str());

    // Get the current environment block
    LPCH currentEnv = GetEnvironmentStrings();

    // Calculate required size for new environment block
    size_t envSize = 0;
    for (LPCH env = currentEnv; *env; env += strlen(env) + 1) {
        envSize += strlen(env) + 1;
    }
    envSize += strlen("NODE_ENV=production") + 2; // +2 for null terminators

    // Create new environment block
    char* newEnv = new char[envSize];
    char* envPtr = newEnv;

    // Copy existing environment variables
    for (LPCH env = currentEnv; *env; env += strlen(env) + 1) {
        strcpy(envPtr, env);
        envPtr += strlen(env) + 1;
    }

    // Add NODE_ENV=production
    strcpy(envPtr, "NODE_ENV=production");
    envPtr += strlen("NODE_ENV=production") + 1;
    *envPtr = '\0'; // Double null termination

    CreateProcess(
        executablePath,    // LPCSTR lpApplicationName
        commandLine,       // LPSTR lpCommandLine
        NULL,             // LPSECURITY_ATTRIBUTES lpProcessAttributes
        NULL,             // LPSECURITY_ATTRIBUTES lpThreadAttributes
        FALSE,            // BOOL bInheritHandles
        CREATE_NO_WINDOW, // DWORD dwCreationFlags
        newEnv,          // LPVOID lpEnvironment
        NULL,            // LPCSTR lpCurrentDirectory
        &si,              // LPSTARTUPINFO lpStartupInfo
        &pi               // LPPROCESS_INFORMATION lpProcessInformation
    );

    // Clean up
    FreeEnvironmentStrings(currentEnv);
    delete[] newEnv;
    delete[] commandLine;  // Clean up the dynamically allocated command line

    return 0;
}