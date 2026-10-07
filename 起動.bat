@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PYCMD="
set "URL=http://localhost:8788/"

rem 議事録アプリをローカルで起動します（http://localhost:8788/）。

rem このウィンドウを閉じるとサーバーが停止し、アプリは使えなくなります。

rem 使っている間はこのウィンドウを閉じないでください。最小化は問題ありません。

title 議事録アプリ（閉じると停止します）

python -c "import sys" >nul 2>nul
if not errorlevel 1 set "PYCMD=python"
if not defined PYCMD (
    py -3 -c "import sys" >nul 2>nul
    if not errorlevel 1 set "PYCMD=py -3"
)
if not defined PYCMD goto :nopython

netstat -ano | findstr /r /c:":8788 .*LISTENING" >nul 2>nul
if not errorlevel 1 goto :portbusy

echo 議事録アプリを起動しています: %URL%

echo このウィンドウを閉じるとアプリは停止します。

echo.
start "" %URL%
%PYCMD% -m http.server 8788 --bind 127.0.0.1
if errorlevel 1 goto :serverfail
exit /b 0

:nopython
echo Python が見つかりません。

echo https://www.python.org/downloads/ から Python 3 をインストールしてください。

echo インストール時は「Add python.exe to PATH」にチェックを入れてください。

echo.
pause
exit /b 1

:portbusy
echo ポート 8788 は既に使用中です。すでにこのアプリが起動している可能性があります。

echo 起動済みのウィンドウを閉じてから、もう一度このファイルを実行してください。

echo ブラウザで %URL% を開きます。

start "" %URL%
echo.
pause
exit /b 1

:serverfail
echo.
echo サーバーが停止しました。ポート 8788 が他のアプリで使われていないか確認してください。

pause
exit /b 1
