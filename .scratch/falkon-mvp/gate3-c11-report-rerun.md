
> falkon@ eval /Users/aeres/Desktop/projects/sourcebot-clone/.claude/worktrees/cycle6-auth-models-29b452
> pnpm --filter @falkon/eval eval -- report --model haiku --arms clone-tools


> @falkon/eval@0.1.0 eval /Users/aeres/Desktop/projects/sourcebot-clone/.claude/worktrees/cycle6-auth-models-29b452/tests/eval
> tsx cli.ts -- report --model haiku --arms clone-tools

# Falkon O3 Ask-quality check (dev and hidden)

Model: haiku (claude-haiku-5-5). Reference: v6-tools runs of this model. Differences are arm minus reference, per question id, pooled across openmrs-xrepo and openmrs-xrepo-unnamed. 95% bootstrap CI, seed 20261017, 10000 resamples.
Gate (regression gate item 3, D25): pooled over dev and hidden, the lower CI bound of the recall difference is at or above -0.1, losses are at most 2 x wins (a win or loss is a recall difference of more than 0.001), and no run failed, was malformed or leaked.

## dev

Floor: n 48; recall 0.8823; precision 0.4123; cost 0.0071.

### clone-tools (dev)

Coverage clone-tools: 48/48 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9708 | 0.8823 | 48 | 0.0885 [0.0156, 0.1771] |
| precision | 0.4197 | 0.4123 | 48 | 0.0075 [-0.0546, 0.0713] |
| cost | 0.0073 | 0.0071 | 48 | 0.0002 [-0.0004, 0.0008] |

Recall wins 7, losses 1, ties 40 against the reference.
Mean turns 14.52; mean wall clock 34475 ms.
Reference: n 48, failed 0, malformed 0, leaks 0.

## hidden

Floor: n 32; recall 0.8193; precision 0.3601; cost 0.0079.

### clone-tools (hidden)

Coverage clone-tools: 32/32 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9427 | 0.8193 | 32 | 0.1234 [0.0547, 0.2016] |
| precision | 0.3988 | 0.3601 | 32 | 0.0387 [-0.0315, 0.1174] |
| cost | 0.0071 | 0.0079 | 32 | -0.0008 [-0.0018, 0.0002] |

Recall wins 9, losses 0, ties 23 against the reference.
Mean turns 13.88; mean wall clock 34202 ms.
Reference: n 32, failed 0, malformed 0, leaks 0.

## Pooled verdict (dev and hidden)

### clone-tools

Coverage clone-tools: 80/80 paired; failed 0; malformed 0; leaks 0.
Denied research_codebase attempts: 0.

| Metric | Arm mean | Reference mean | n | Difference [95% CI] |
| --- | ---: | ---: | ---: | --- |
| recall | 0.9596 | 0.8571 | 80 | 0.1025 [0.0479, 0.1640] |
| precision | 0.4114 | 0.3914 | 80 | 0.0200 [-0.0261, 0.0708] |
| cost | 0.0073 | 0.0074 | 80 | -0.0002 [-0.0008, 0.0003] |

Recall wins 16, losses 1, ties 63 against the reference.
Mean turns 14.26; mean wall clock 34365 ms.
Reference: n 80, failed 0, malformed 0, leaks 0.

clone-tools: PASS. n 80; recall difference 0.1025 [0.0479, 0.1640]; wins 16, losses 1, ties 63.
