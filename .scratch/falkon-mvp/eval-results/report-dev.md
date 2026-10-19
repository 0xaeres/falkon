# Falkon O3 Ask-quality check (dev)

Differences are arm minus the recorded floor, per question id, pooled across openmrs-xrepo and openmrs-xrepo-unnamed. 95% bootstrap CI, seed 20261017, 10000 resamples.
Gate (regression gate item 3): the lower CI bound of the recall difference is at or above -0.05.

Floor: n 48; recall 0.9726; precision 0.6159; cost 0.0386.

## clone-tools

Coverage clone-tools: 48/48 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Floor mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9500 | 0.9726 | 48 | -0.0226 [-0.0764, 0.0208] |
| precision | 0.5826 | 0.6159 | 48 | -0.0334 [-0.0891, 0.0195] |
| cost | 0.0416 | 0.0386 | 48 | 0.0030 [-0.0008, 0.0070] |

Mean turns 5.38; mean wall clock 21305 ms.

clone-tools: FAIL. Recall difference lower bound -0.0764.

## clone-research

Coverage clone-research: 48/48 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Floor mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9049 | 0.9726 | 48 | -0.0677 [-0.1215, -0.0191] |
| precision | 0.5094 | 0.6159 | 48 | -0.1065 [-0.1657, -0.0509] |
| cost | 0.0530 | 0.0386 | 48 | 0.0144 [0.0099, 0.0189] |

Mean turns 6.42; mean wall clock 23672 ms.
research_codebase first in 48/48 runs.

clone-research: FAIL. Recall difference lower bound -0.1215.
