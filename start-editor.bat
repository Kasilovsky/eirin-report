@echo off
chcp 65001 >nul
title 永遠亭 · 刊首語編輯器
cd /d "E:\厨神善区\永琳报"

netstat -ano | findstr ":8766" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo 编辑器已在运行，正在打开浏览器...
  start "" "http://127.0.0.1:8766/"
  timeout /t 2 >nul
  exit /b 0
)

echo 正在启动刊首语编辑器...
start "" "http://127.0.0.1:8766/"
python edit_server.py
pause
