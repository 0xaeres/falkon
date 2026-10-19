# G3 O3 Sourcebot access report (hidden)

dRecall and dCost are Falcon minus Sourcebot. Paired comparison tables use the named candidate minus control.

Decision rule agreed in advance:
> Falcon differentiated by cost: dCost 95% CI upper bound < 0 AND dRecall CI lower bound >= -0.05.
> Falcon differentiated by recall: dRecall CI lower bound > 0.
> Not differentiated: dRecall CI upper bound <= 0.05 (sourcebot minus falcon recall CI lower bound >= -0.05) AND mean sourcebot-slim cost <= 1.10 times mean falcon-slim cost.
> Otherwise: unresolved tie.
> Precedence: if a differentiated condition holds, the verdict is Falcon differentiated (cost) or (recall). When both differentiated conditions hold, cost takes precedence.

With 24 dev and 16 hidden questions per variant the intervals resolve about 0.1 of recall, so a within-margin result is a tie, not proof of equivalence.

## named

Coverage: sourcebot-slim vs falcon-slim: 16/16 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim vs reference-all: 16/16 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim-map vs falcon-slim-map: 0/16 paired; failed 0; malformed 0; leaks 0.

| Arm | Mean recall | Precision | Cost USD | Turns | Cache creation tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| sourcebot-slim | 0.9271 | 0.5608 | 0.0392 | 5.06 | 4946.7 |
| sourcebot-slim-map | 0.9146 | 0.5344 | 0.0497 | 4.63 | 7618.3 |
| falcon-slim | 0.8677 | 0.5747 | 0.0435 | 5.00 | 6496.1 |
| reference-all | 0.8656 | 0.5490 | 0.0596 | 6.44 | 9362.9 |
| falcon-slim-map | 0.0000 | 0.0000 | 0.0000 | 0.00 | 0.0 |

| Comparison | Metric | n | Mean difference [95% CI] |
| --- | --- | ---: | --- |
| sourcebot-slim−falcon-slim | recall | 16 | 0.0594 [-0.0260, 0.1531] |
| sourcebot-slim−falcon-slim | precision | 16 | -0.0138 [-0.1278, 0.1138] |
| sourcebot-slim−falcon-slim | cost | 16 | -0.0043 [-0.0120, 0.0026] |
| sourcebot-slim−reference-all | recall | 16 | 0.0615 [-0.0104, 0.1500] |
| sourcebot-slim−reference-all | precision | 16 | 0.0118 [-0.0986, 0.1354] |
| sourcebot-slim−reference-all | cost | 16 | -0.0204 [-0.0285, -0.0118] |
| sourcebot-slim-map−falcon-slim-map | recall | 0 | n/a (no paired runs) |
| sourcebot-slim-map−falcon-slim-map | precision | 0 | n/a (no paired runs) |
| sourcebot-slim-map−falcon-slim-map | cost | 0 | n/a (no paired runs) |

dRecall: -0.0594 [-0.1531, 0.0260]; dCost: 0.0043 [-0.0026, 0.0120].
Verdict: Not differentiated.
interval wider than 0.15: resolution is poor
Dev verdict it confirms against: Not differentiated.

Drift check (falcon-slim rerun minus cycle 15, all recorded drift questions): n 8; mean cost difference 0.0015; mean recall difference -0.2188; invalid 0.

## unnamed

Coverage: sourcebot-slim vs falcon-slim: 16/16 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim vs reference-all: 16/16 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim-map vs falcon-slim-map: 0/16 paired; failed 0; malformed 0; leaks 0.

| Arm | Mean recall | Precision | Cost USD | Turns | Cache creation tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| sourcebot-slim | 0.9187 | 0.5475 | 0.0397 | 5.06 | 5004.3 |
| sourcebot-slim-map | 0.9146 | 0.5524 | 0.0467 | 4.81 | 6787.6 |
| falcon-slim | 0.8396 | 0.5579 | 0.0414 | 4.81 | 6310.0 |
| reference-all | 0.9313 | 0.5861 | 0.0608 | 6.38 | 9712.3 |
| falcon-slim-map | 0.0000 | 0.0000 | 0.0000 | 0.00 | 0.0 |

| Comparison | Metric | n | Mean difference [95% CI] |
| --- | --- | ---: | --- |
| sourcebot-slim−falcon-slim | recall | 16 | 0.0792 [-0.0292, 0.1875] |
| sourcebot-slim−falcon-slim | precision | 16 | -0.0104 [-0.1137, 0.0846] |
| sourcebot-slim−falcon-slim | cost | 16 | -0.0017 [-0.0091, 0.0053] |
| sourcebot-slim−reference-all | recall | 16 | -0.0125 [-0.1062, 0.0813] |
| sourcebot-slim−reference-all | precision | 16 | -0.0386 [-0.1604, 0.0671] |
| sourcebot-slim−reference-all | cost | 16 | -0.0211 [-0.0361, -0.0091] |
| sourcebot-slim-map−falcon-slim-map | recall | 0 | n/a (no paired runs) |
| sourcebot-slim-map−falcon-slim-map | precision | 0 | n/a (no paired runs) |
| sourcebot-slim-map−falcon-slim-map | cost | 0 | n/a (no paired runs) |

dRecall: -0.0792 [-0.1875, 0.0292]; dCost: 0.0017 [-0.0053, 0.0091].
Verdict: Not differentiated.
interval wider than 0.15: resolution is poor
Dev verdict it confirms against: Not differentiated.

Drift check (falcon-slim rerun minus cycle 15, all recorded drift questions): n 8; mean cost difference -0.0031; mean recall difference -0.0313; invalid 0.

## pooled

Coverage: sourcebot-slim vs falcon-slim: 32/32 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim vs reference-all: 32/32 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim-map vs falcon-slim-map: 0/32 paired; failed 0; malformed 0; leaks 0.

| Arm | Mean recall | Precision | Cost USD | Turns | Cache creation tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| sourcebot-slim | 0.9229 | 0.5542 | 0.0394 | 5.06 | 4975.5 |
| sourcebot-slim-map | 0.9146 | 0.5434 | 0.0482 | 4.72 | 7202.9 |
| falcon-slim | 0.8536 | 0.5663 | 0.0424 | 4.91 | 6403.1 |
| reference-all | 0.8984 | 0.5676 | 0.0602 | 6.41 | 9537.6 |
| falcon-slim-map | 0.0000 | 0.0000 | 0.0000 | 0.00 | 0.0 |

| Comparison | Metric | n | Mean difference [95% CI] |
| --- | --- | ---: | --- |
| sourcebot-slim−falcon-slim | recall | 32 | 0.0693 [-0.0005, 0.1417] |
| sourcebot-slim−falcon-slim | precision | 32 | -0.0121 [-0.0883, 0.0656] |
| sourcebot-slim−falcon-slim | cost | 32 | -0.0030 [-0.0083, 0.0020] |
| sourcebot-slim−reference-all | recall | 32 | 0.0245 [-0.0365, 0.0875] |
| sourcebot-slim−reference-all | precision | 32 | -0.0134 [-0.0968, 0.0675] |
| sourcebot-slim−reference-all | cost | 32 | -0.0208 [-0.0292, -0.0132] |
| sourcebot-slim-map−falcon-slim-map | recall | 0 | n/a (no paired runs) |
| sourcebot-slim-map−falcon-slim-map | precision | 0 | n/a (no paired runs) |
| sourcebot-slim-map−falcon-slim-map | cost | 0 | n/a (no paired runs) |

dRecall: -0.0693 [-0.1417, 0.0005]; dCost: 0.0030 [-0.0020, 0.0083].
Verdict: Not differentiated.
Dev verdict it confirms against: Not differentiated.

Drift check (falcon-slim rerun minus cycle 15, all recorded drift questions): n 16; mean cost difference -0.0008; mean recall difference -0.1250; invalid 0.
