#!/bin/sh
# Startet den lokalen Server. Next benennt den Prozess in "next-server (...)"
# um -- darum wird danach gesucht und nicht nach dem Skriptnamen.
for i in 1 2 3 4 5; do
  PID=$(ps -eo pid,cmd | grep -E 'next-server|standalone/server\.js' \
        | grep -v grep | awk '{print $1}')
  [ -z "$PID" ] && break
  kill -9 $PID 2>/dev/null
  sleep 2
done
sleep 1
exec node --env-file=/home/claude/stig-verwaltung/lokal.env \
          /home/claude/stig-verwaltung/app/.next/standalone/server.js
