xrepo-framework-to-chart-21 clone-tools first=Grep tools=none recall=1.00 cost=0.0473 leak=false denied=0 malformed=false
xrepo-framework-to-chart-21 clone-research first=research_codebase tools=research_codebase:1 recall=1.00 cost=0.0573 leak=false denied=0 malformed=false
xrepo-docs-20 clone-tools first=grep tools=grep:4 recall=1.00 cost=0.0620 leak=false denied=0 malformed=false
xrepo-docs-20 clone-research first=research_codebase tools=research_codebase:1,grep:4,read_file:2 recall=0.50 cost=0.0792 leak=false denied=0 malformed=false
xrepo-core-to-rest-3 clone-tools first=grep tools=grep:2 recall=1.00 cost=0.0551 leak=false denied=0 malformed=false
xrepo-core-to-rest-3 clone-research first=research_codebase tools=research_codebase:1,grep:1 recall=1.00 cost=0.0299 leak=false denied=0 malformed=false
xrepo-trace-11 clone-tools first=Grep tools=grep:4 recall=1.00 cost=0.0514 leak=false denied=0 malformed=false
xrepo-trace-11 clone-research first=research_codebase tools=research_codebase:1,grep:4,read_file:2 recall=1.00 cost=0.0734 leak=false denied=0 malformed=false
xrepo-framework-to-chart-7 clone-tools first=Grep tools=none recall=0.75 cost=0.0192 leak=false denied=0 malformed=false
xrepo-framework-to-chart-7 clone-research first=research_codebase tools=research_codebase:1 recall=0.75 cost=0.0246 leak=false denied=0 malformed=false

Stop rules (spec S5):
PASS: plain-arm pilot recall 0.950 (needs complete runs and at least 0.80)
PASS: no leaks (0 of 10 runs)
PASS: research_codebase first in every research run (5/5)
Denied research_codebase attempts by the plain arm: 0.
