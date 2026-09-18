@echo off
rem SPECTRA - Windows launcher.
rem
rem Opens the standalone build in a dedicated Chrome window with the background
rem throttling rules switched off, so the render loop keeps full rate when the
rem window is minimised or another app takes focus.
rem
rem Setup: put this file next to SPECTRA-standalone.html and double-click it.

setlocal
set HERE=%~dp0

set APP=%HERE%SPECTRA-standalone.html
if not exist "%APP%" set APP=%HERE%..\SPECTRA-standalone.html
if not exist "%APP%" (
  echo SPECTRA-standalone.html not found next to this launcher.
  pause
  exit /b 1
)

rem A separate profile directory. Without it Chrome hands the URL to an already
rem running instance and none of the flags below apply.
set PROFILE=%LOCALAPPDATA%\SPECTRA-chrome

set BROWSER=
for %%B in (
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\BraveSoftware\Brave-Browser\Application\brave.exe"
) do if not defined BROWSER if exist %%B set BROWSER=%%B

if not defined BROWSER (
  echo No Chrome-family browser found. Install Google Chrome, or open
  echo SPECTRA-standalone.html by hand.
  pause
  exit /b 1
)

start "" %BROWSER% ^
  --app="file:///%APP:\=/%" ^
  --user-data-dir="%PROFILE%" ^
  --disable-background-timer-throttling ^
  --disable-backgrounding-occluded-windows ^
  --disable-renderer-backgrounding ^
  --disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling ^
  --autoplay-policy=no-user-gesture-required ^
  --disable-popup-blocking ^
  --enable-gpu-rasterization ^
  --disable-frame-rate-limit ^
  --start-maximized

endlocal
