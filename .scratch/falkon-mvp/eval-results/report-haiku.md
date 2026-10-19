# Falkon O3 Ask-quality check (dev and hidden)

Model: haiku (claude-haiku-5-5). Reference: v6-tools runs of this model. Differences are arm minus reference, per question id, pooled across openmrs-xrepo and openmrs-xrepo-unnamed. 95% bootstrap CI, seed 20261017, 10000
Gate (regression gate item 3, D25): pooled over dev and hidden, the lower CI bound of the recall difference is at or above -0.1, losses are at most 2 x wins (a win or loss is a recall difference of more than 0.001), and 

## dev

Floor: n 48; recall 0.8823; precision 0.4123; cost 0.0071.

### clone-tools (dev)

Coverage clone-tools: 48/48 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9292 | 0.8823 | 48 | 0.0469 [-0.0417, 0.1458] |
| precision | 0.3835 | 0.4123 | 48 | -0.0288 [-0.1063, 0.0461] |
| cost | 0.0072 | 0.0071 | 48 | 0.0001 [-0.0004, 0.0007] |

Recall wins 5, losses 3, ties 40 against the reference.
Mean turns 14.52; mean wall clock 34096 ms.
Reference: n 48, failed 0, malformed 0, leaks 0.

### clone-tools-noinstr (dev)

Coverage clone-tools-noinstr: 48/48 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9160 | 0.8823 | 48 | 0.0337 [-0.0656, 0.1406] |
| precision | 0.4386 | 0.4123 | 48 | 0.0263 [-0.0384, 0.0960] |
| cost | 0.0069 | 0.0071 | 48 | -0.0003 [-0.0009, 0.0003] |

Recall wins 7, losses 5, ties 36 against the reference.
Mean turns 14.73; mean wall clock 32862 ms.
Reference: n 48, failed 0, malformed 0, leaks 0.

### clone-research (dev)

Coverage clone-research: 48/48 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8094 | 0.8823 | 48 | -0.0729 [-0.1823, 0.0365] |
| precision | 0.3852 | 0.4123 | 48 | -0.0271 [-0.1008, 0.0447] |
| cost | 0.0063 | 0.0071 | 48 | -0.0008 [-0.0014, -0.0002] |

Recall wins 5, losses 11, ties 32 against the reference.
Mean turns 12.90; mean wall clock 29826 ms.
research_codebase first in 48/48 runs.
Reference: n 48, failed 0, malformed 0, leaks 0.

## hidden

Floor: n 32; recall 0.8193; precision 0.3601; cost 0.0079.

### clone-tools (hidden)

Coverage clone-tools: 32/32 paired; failed 0; malformed 0; leaks 1.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8729 | 0.8193 | 32 | 0.0536 [-0.0271, 0.1406] |
| precision | 0.3692 | 0.3601 | 32 | 0.0092 [-0.0358, 0.0600] |
| cost | 0.0080 | 0.0079 | 32 | 0.0000 [-0.0008, 0.0009] |

Recall wins 7, losses 3, ties 22 against the reference.
Mean turns 15.22; mean wall clock 36019 ms.
Reference: n 32, failed 0, malformed 0, leaks 1.

### clone-tools-noinstr (hidden)

Coverage clone-tools-noinstr: 32/32 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8281 | 0.8193 | 32 | 0.0089 [-0.1031, 0.1120] |
| precision | 0.3756 | 0.3601 | 32 | 0.0156 [-0.0459, 0.0834] |
| cost | 0.0074 | 0.0079 | 32 | -0.0005 [-0.0015, 0.0005] |

Recall wins 6, losses 3, ties 23 against the reference.
Mean turns 15.34; mean wall clock 33748 ms.
Reference: n 32, failed 0, malformed 0, leaks 1.

### clone-research (hidden)

Coverage clone-research: 32/32 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8427 | 0.8193 | 32 | 0.0234 [-0.0724, 0.1224] |
| precision | 0.4157 | 0.3601 | 32 | 0.0556 [-0.0435, 0.1624] |
| cost | 0.0066 | 0.0079 | 32 | -0.0013 [-0.0023, -0.0005] |

Recall wins 6, losses 4, ties 22 against the reference.
Mean turns 12.84; mean wall clock 31271 ms.
research_codebase first in 32/32 runs.
Reference: n 32, failed 0, malformed 0, leaks 1.

## Pooled verdict (dev and hidden)

### clone-tools

Coverage clone-tools: 80/80 paired; failed 0; malformed 0; leaks 1.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9067 | 0.8571 | 80 | 0.0496 [-0.0140, 0.1177] |
| precision | 0.3778 | 0.3914 | 80 | -0.0136 [-0.0623, 0.0359] |
| cost | 0.0075 | 0.0074 | 80 | 0.0001 [-0.0004, 0.0006] |

Recall wins 12, losses 6, ties 62 against the reference.
Mean turns 14.80; mean wall clock 34865 ms.
Reference: n 80, failed 0, malformed 0, leaks 1.

clone-tools: withheld (incomplete coverage, failed, malformed or leaking runs). n 80; recall difference 0.0496 [-0.0140, 0.1177]; wins 12, losses 6, ties 62.

### clone-tools-noinstr

Coverage clone-tools-noinstr: 80/80 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8808 | 0.8571 | 80 | 0.0237 [-0.0502, 0.1008] |
| precision | 0.4134 | 0.3914 | 80 | 0.0220 [-0.0246, 0.0696] |
| cost | 0.0071 | 0.0074 | 80 | -0.0004 [-0.0009, 0.0002] |

Recall wins 13, losses 8, ties 59 against the reference.
Mean turns 14.97; mean wall clock 33216 ms.
Reference: n 80, failed 0, malformed 0, leaks 1.

clone-tools-noinstr: withheld (incomplete coverage, failed, malformed or leaking runs). n 80; recall difference 0.0237 [-0.0502, 0.1008]; wins 13, losses 8, ties 59.

### clone-research

Coverage clone-research: 80/80 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.8227 | 0.8571 | 80 | -0.0344 [-0.1115, 0.0444] |
| precision | 0.3974 | 0.3914 | 80 | 0.0060 [-0.0539, 0.0680] |
| cost | 0.0064 | 0.0074 | 80 | -0.0010 [-0.0016, -0.0005] |

Recall wins 11, losses 15, ties 54 against the reference.
Mean turns 12.88; mean wall clock 30404 ms.
research_codebase first in 80/80 runs.
Reference: n 80, failed 0, malformed 0, leaks 1.

clone-research: withheld (incomplete coverage, failed, malformed or leaking runs). n 80; recall difference -0.0344 [-0.1115, 0.0444]; wins 11, losses 15, ties 54.
