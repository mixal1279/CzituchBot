'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { evaluateRetrieval, aggregateRetrievalMetrics } = require('../ai/retrieval-evaluation');

function runRetrievalBenchmark(file = path.join(__dirname, '..', 'test', 'fixtures', 'retrieval-cases.json')) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(data.cases) || !data.cases.length) throw new Error('Benchmark retrieval nie zawiera przypadków');
  const results = data.cases.map(item => {
    if (!item.id || !Array.isArray(item.ranked) || !Array.isArray(item.relevant)) {
      throw new Error('Nieprawidłowy przypadek benchmarku retrieval: ' + String(item.id || 'unknown'));
    }
    return { id: String(item.id), ...evaluateRetrieval(item.ranked, item.relevant, { k: item.k, relevanceById: item.relevance }) };
  });
  return { benchmark: 'retrieval-offline-v1', total: results.length, metrics: aggregateRetrievalMetrics(results), results };
}
if (require.main === module) process.stdout.write(JSON.stringify(runRetrievalBenchmark(process.argv[2]), null, 2) + '\n');
module.exports = { runRetrievalBenchmark };
