'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { reciprocalRankFusion } = require('../ai/rank-fusion');
const { evaluateRetrieval, aggregateRetrievalMetrics } = require('../ai/retrieval-evaluation');

function runRetrievalBenchmark(file = path.join(__dirname, '..', 'test', 'fixtures', 'retrieval-cases.json')) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.cases) || !data.cases.length) throw new Error('Benchmark retrieval nie zawiera przypadków');
  const results = data.cases.map(item => {
    if (!item.id || !Array.isArray(item.rankings) || !item.rankings.length || !Array.isArray(item.relevant)) {
      throw new Error('Nieprawidłowy przypadek benchmarku retrieval: ' + String(item.id || 'unknown'));
    }
    const fusedRanking = reciprocalRankFusion(item.rankings, { k: item.rrfK || 60 })
      .map(item => item.id);
    const metrics = evaluateRetrieval(fusedRanking, item.relevant, {
      k: item.k, relevanceById: item.relevance,
    });
    const baselineMetrics = Array.isArray(item.baseline)
      ? evaluateRetrieval(item.baseline, item.relevant, { k: item.k, relevanceById: item.relevance })
      : null;
    return { id: String(item.id), ranked: fusedRanking, metrics, baselineMetrics };
  });
  const withBaseline = results.filter(result => result.baselineMetrics);
  return {
    benchmark: 'retrieval-rrf-offline-v2',
    total: results.length,
    metrics: aggregateRetrievalMetrics(results.map(result => result.metrics)),
    baselineMetrics: aggregateRetrievalMetrics(withBaseline.map(result => result.baselineMetrics)),
    results,
  };
}
if (require.main === module) {
  const report = runRetrievalBenchmark(process.argv[2]);
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (report.metrics.reciprocalRank < report.baselineMetrics.reciprocalRank) {
    process.stderr.write('RRF nie poprawił MRR względem baseline.\n');
    process.exitCode = 1;
  }
}
module.exports = { runRetrievalBenchmark };
