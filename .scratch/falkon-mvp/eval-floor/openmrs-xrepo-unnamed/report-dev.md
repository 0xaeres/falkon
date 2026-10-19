# G3 O3 Sourcebot access report (dev)

dRecall and dCost are Falcon minus Sourcebot. Paired comparison tables use the named candidate minus control.

Decision rule agreed in advance:
> Falcon differentiated by cost: dCost 95% CI upper bound < 0 AND dRecall CI lower bound >= -0.05.
> Falcon differentiated by recall: dRecall CI lower bound > 0.
> Not differentiated: dRecall CI upper bound <= 0.05 (sourcebot minus falcon recall CI lower bound >= -0.05) AND mean sourcebot-slim cost <= 1.10 times mean falcon-slim cost.
> Otherwise: unresolved tie.
> Precedence: if a differentiated condition holds, the verdict is Falcon differentiated (cost) or (recall). When both differentiated conditions hold, cost takes precedence.

With 24 dev and 16 hidden questions per variant the intervals resolve about 0.1 of recall, so a within-margin result is a tie, not proof of equivalence.

## unnamed

Coverage: sourcebot-slim vs falcon-slim: 24/24 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim vs reference-all: 24/24 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim-map vs falcon-slim-map: 24/24 paired; failed 0; malformed 0; leaks 0.

| Arm | Mean recall | Precision | Cost USD | Turns | Cache creation tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| sourcebot-slim | 0.9778 | 0.6542 | 0.0369 | 4.96 | 4637.3 |
| sourcebot-slim-map | 0.9292 | 0.5768 | 0.0432 | 4.71 | 6107.7 |
| falcon-slim | 0.9139 | 0.6174 | 0.0410 | 4.79 | 6297.2 |
| reference-all | 0.8944 | 0.6130 | 0.0574 | 6.79 | 8793.5 |
| falcon-slim-map | 0.9542 | 0.6546 | 0.0493 | 4.67 | 8256.4 |

| Comparison | Metric | n | Mean difference [95% CI] |
| --- | --- | ---: | --- |
| sourcebot-slim−falcon-slim | recall | 24 | 0.0639 [0.0187, 0.1215] |
| sourcebot-slim−falcon-slim | precision | 24 | 0.0369 [-0.0421, 0.1155] |
| sourcebot-slim−falcon-slim | cost | 24 | -0.0041 [-0.0105, 0.0015] |
| sourcebot-slim−reference-all | recall | 24 | 0.0833 [0.0104, 0.1667] |
| sourcebot-slim−reference-all | precision | 24 | 0.0412 [-0.0363, 0.1176] |
| sourcebot-slim−reference-all | cost | 24 | -0.0205 [-0.0274, -0.0142] |
| sourcebot-slim-map−falcon-slim-map | recall | 24 | -0.0250 [-0.1021, 0.0521] |
| sourcebot-slim-map−falcon-slim-map | precision | 24 | -0.0778 [-0.1503, -0.0061] |
| sourcebot-slim-map−falcon-slim-map | cost | 24 | -0.0061 [-0.0138, 0.0006] |

dRecall: -0.0639 [-0.1215, -0.0187]; dCost: 0.0041 [-0.0015, 0.0105].
Verdict: Not differentiated.

Drift check (falcon-slim rerun minus cycle 15, all recorded drift questions): n 8; mean cost difference -0.0031; mean recall difference -0.0313; invalid 0.

## named

Coverage: sourcebot-slim vs falcon-slim: 24/24 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim vs reference-all: 24/24 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim-map vs falcon-slim-map: 24/24 paired; failed 0; malformed 0; leaks 0.

| Arm | Mean recall | Precision | Cost USD | Turns | Cache creation tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| sourcebot-slim | 0.9674 | 0.5776 | 0.0402 | 4.88 | 5386.6 |
| sourcebot-slim-map | 0.8910 | 0.5042 | 0.0483 | 4.42 | 7564.5 |
| falcon-slim | 0.9069 | 0.6680 | 0.0450 | 5.54 | 6959.2 |
| reference-all | 0.8806 | 0.6099 | 0.0551 | 6.71 | 8402.6 |
| falcon-slim-map | 0.9035 | 0.6254 | 0.0502 | 4.88 | 8370.0 |

| Comparison | Metric | n | Mean difference [95% CI] |
| --- | --- | ---: | --- |
| sourcebot-slim−falcon-slim | recall | 24 | 0.0604 [0.0083, 0.1299] |
| sourcebot-slim−falcon-slim | precision | 24 | -0.0903 [-0.1877, 0.0081] |
| sourcebot-slim−falcon-slim | cost | 24 | -0.0048 [-0.0121, 0.0029] |
| sourcebot-slim−reference-all | recall | 24 | 0.0868 [0.0208, 0.1667] |
| sourcebot-slim−reference-all | precision | 24 | -0.0322 [-0.1184, 0.0460] |
| sourcebot-slim−reference-all | cost | 24 | -0.0149 [-0.0210, -0.0080] |
| sourcebot-slim-map−falcon-slim-map | recall | 24 | -0.0125 [-0.1181, 0.0951] |
| sourcebot-slim-map−falcon-slim-map | precision | 24 | -0.1213 [-0.2224, -0.0224] |
| sourcebot-slim-map−falcon-slim-map | cost | 24 | -0.0019 [-0.0080, 0.0036] |

dRecall: -0.0604 [-0.1299, -0.0083]; dCost: 0.0048 [-0.0029, 0.0121].
Verdict: Not differentiated.

Drift check (falcon-slim rerun minus cycle 15, all recorded drift questions): n 8; mean cost difference 0.0015; mean recall difference -0.2188; invalid 0.

## pooled

Coverage: sourcebot-slim vs falcon-slim: 48/48 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim vs reference-all: 48/48 paired; failed 0; malformed 0; leaks 0.
Coverage: sourcebot-slim-map vs falcon-slim-map: 48/48 paired; failed 0; malformed 0; leaks 0.

| Arm | Mean recall | Precision | Cost USD | Turns | Cache creation tokens |
| --- | ---: | ---: | ---: | ---: | ---: |
| sourcebot-slim | 0.9726 | 0.6159 | 0.0386 | 4.92 | 5011.9 |
| sourcebot-slim-map | 0.9101 | 0.5405 | 0.0458 | 4.56 | 6836.1 |
| falcon-slim | 0.9104 | 0.6427 | 0.0430 | 5.17 | 6628.2 |
| reference-all | 0.8875 | 0.6114 | 0.0563 | 6.75 | 8598.1 |
| falcon-slim-map | 0.9288 | 0.6400 | 0.0498 | 4.77 | 8313.2 |

| Comparison | Metric | n | Mean difference [95% CI] |
| --- | --- | ---: | --- |
| sourcebot-slim−falcon-slim | recall | 48 | 0.0622 [0.0260, 0.1062] |
| sourcebot-slim−falcon-slim | precision | 48 | -0.0267 [-0.0900, 0.0372] |
| sourcebot-slim−falcon-slim | cost | 48 | -0.0044 [-0.0095, 0.0003] |
| sourcebot-slim−reference-all | recall | 48 | 0.0851 [0.0347, 0.1372] |
| sourcebot-slim−reference-all | precision | 48 | 0.0045 [-0.0536, 0.0608] |
| sourcebot-slim−reference-all | cost | 48 | -0.0177 [-0.0223, -0.0130] |
| sourcebot-slim-map−falcon-slim-map | recall | 48 | -0.0187 [-0.0813, 0.0483] |
| sourcebot-slim-map−falcon-slim-map | precision | 48 | -0.0995 [-0.1620, -0.0387] |
| sourcebot-slim-map−falcon-slim-map | cost | 48 | -0.0040 [-0.0089, 0.0005] |

dRecall: -0.0622 [-0.1062, -0.0260]; dCost: 0.0044 [-0.0003, 0.0095].
Verdict: Not differentiated.

Drift check (falcon-slim rerun minus cycle 15, all recorded drift questions): n 16; mean cost difference -0.0008; mean recall difference -0.1250; invalid 0.
