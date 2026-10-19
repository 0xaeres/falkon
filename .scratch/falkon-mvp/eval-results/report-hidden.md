# Falkon O3 Ask-quality check (hidden)

Differences are arm minus the recorded floor, per question id, pooled across openmrs-xrepo and openmrs-xrepo-unnamed. 95% bootstrap CI, seed 20261017, 10000 resamples.
Gate (regression gate item 3): the lower CI bound of the recall difference is at or above -0.05.

Floor: n 32; recall 0.9229; precision 0.5542; cost 0.0394.

## clone-tools

Coverage clone-tools: 32/32 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Floor mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9260 | 0.9229 | 32 | 0.0031 [-0.0938, 0.0927] |
| precision | 0.5812 | 0.5542 | 32 | 0.0271 [-0.0529, 0.1088] |
| cost | 0.0422 | 0.0394 | 32 | 0.0028 [-0.0025, 0.0094] |

Mean turns 5.13; mean wall clock 17712 ms.

clone-tools: FAIL. Recall difference lower bound -0.0938.

## clone-research

Coverage clone-research: 32/32 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Floor mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9427 | 0.9229 | 32 | 0.0198 [-0.0615, 0.1031] |
| precision | 0.5291 | 0.5542 | 32 | -0.0251 [-0.0909, 0.0337] |
| cost | 0.0516 | 0.0394 | 32 | 0.0122 [0.0060, 0.0182] |

Mean turns 6.06; mean wall clock 19735 ms.
research_codebase first in 32/32 runs.

clone-research: FAIL. Recall difference lower bound -0.0615.
