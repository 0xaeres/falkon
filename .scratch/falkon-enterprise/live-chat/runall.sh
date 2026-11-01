#!/bin/sh
# Remaining S92 questions with a spend guard: stop when the conservative estimate (0.30/M in, 1.00/M out) passes $2.90 in total.
cd "$(dirname "$0")"
over() { node tok.js r3 r4 | awk '{print ($NF > 2.90) ? "stop" : "go"}'; }
for q in $(node -e 'console.log(require("./q-eval.json").map(q=>q.id).filter(i=>i!=="xrepo-trace-11").join(" "))'); do
  [ "$(over)" = go ] || { echo "SPEND GUARD STOP before $q"; exit 0; }
  SLUG=openmrs QFILE=q-eval.json node ask.js $q r4
done
for q in q01 q03 q04 q05 q06 q07 q08 q10; do
  [ "$(over)" = go ] || { echo "SPEND GUARD STOP before $q"; exit 0; }
  SLUG=billing QFILE=q-human.json node ask.js $q r4
done
echo finished
