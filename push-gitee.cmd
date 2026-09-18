@echo off
setlocal
cd /d "%~dp0"

if "%~1"=="" goto usage
set OWNER=%~1
set REPO=%~2
if "%REPO%"=="" set REPO=turbo_-scheduling

echo ==========================================
echo  Turbo Scheduling  --^>  Gitee
echo ==========================================
echo.

where git >nul 2>nul
if errorlevel 1 goto nogit
for /f "tokens=*" %%i in ('git config --global user.name 2^>nul') do set GITNAME=%%i
if "%GITNAME%"=="" goto noname

echo [1/5] bind repo   %OWNER%/%REPO%
node set-gitee.js %OWNER% %REPO%
if errorlevel 1 goto fail
echo.

echo [2/5] build module zip + refresh update.json / changelog.md
node release.js
if errorlevel 1 goto fail
echo.

echo [3/5] init local repo and commit
if not exist ".git" git init
git add -A
git commit -m "v26.103"
git branch -M master
echo.

echo [4/5] set remote
git remote remove origin >nul 2>nul
git remote add origin https://gitee.com/%OWNER%/%REPO%.git
echo.

echo [5/5] push  (enter your Gitee username and password / personal token)
git push -u origin master
if errorlevel 1 goto pushfail

echo.
echo ==========================================
echo  DONE.
echo   - the module zip in this folder is the update source
echo   - on your phone: open KernelSU manager, pull to refresh
echo     it should show v26.103 as available
echo   - next release: bump version, run  node release.js
echo     then  git add -A ^&^& git commit -m "vX" ^&^& git tag vX ^&^& git push --tags
echo ==========================================
goto end

:usage
echo Usage:  push-gitee.cmd ^<gitee-user^> [repo-name]
echo Example: push-gitee.cmd turbowfz turbo_-scheduling
echo.
echo Create an EMPTY repository on gitee.com first
echo (do NOT let Gitee initialize it with a README).
goto end

:nogit
echo [!] git not found.
echo     Install Git for Windows: https://git-scm.com/download/win
echo     Then close this window, open a new one and run this script again.
goto end

:noname
echo [!] git identity is not set. Run these two first:
echo       git config --global user.name  "YourName"
echo       git config --global user.email "you@example.com"
goto end

:fail
echo [!] step failed, see the message above.
goto end

:pushfail
echo [!] push failed - check the repo URL and your credentials.
goto end

:end
endlocal
pause
