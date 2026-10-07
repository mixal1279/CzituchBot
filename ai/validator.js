    : answerCoverage.ok && claims.length >= Math.min(3, Math.ceil(sentenceCount / 3));
  const evidenceContractOk = !dane || !answer || evidenceAssessment.status !== 'weak';

  const claimContractOk = claims.length > 0
    && claims.every(c => c.supported)
    && !unknownSourceClaim