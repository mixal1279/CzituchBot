# AI benchmark diagnosis setup

## CI Doctor (GitHub Agentic Workflows)

Source definition: `.github/workflows/ai-benchmark-doctor.md`.

This is a GitHub Agentic Workflow definition, not a standard GitHub Actions YAML
workflow. It does not execute until the repository is initialized with the
official `gh-aw` CLI, the workflow is added/compiled, and an AI engine is
configured. Follow the official installation and compilation steps:
https://github.github.com/gh-aw/setup/working-with-workflows/

After setup, verify the generated lock file and review triggers, permissions,
safe outputs, and the AI engine configuration. The workflow is scoped to failed
`AI live benchmark` runs and does not modify source code. It can create a
diagnosis issue or comment through declared safe outputs.

## AgentRx

The standard workflow `.github/workflows/agentrx-benchmark.yml` is triggered
after a failed `AI live benchmark` run. It downloads that run's report,
converts each failed case into a dialogue-style trajectory and runs Microsoft's
AgentRx against each case. Diagnosis is advisory and never changes the original
benchmark result.

Configure these GitHub Actions repository secrets:

- `AGENT_VERIFY_ENDPOINT`: Azure OpenAI endpoint URL
- `AGENT_VERIFY_DEPLOYMENT`: Azure OpenAI deployment name
- `AGENT_VERIFY_MODEL_NAME`: model name matching that deployment
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`: Azure
  workload identity credentials for `azure/login`

The Azure identity must be configured for GitHub Actions OIDC and authorized to
invoke the selected Azure OpenAI deployment. Do not store API keys in workflow
files.

The benchmark records provider attempts, timing events and validator results
in separate arrays. The adapter preserves the order within each array but
cannot reconstruct exact cross-array chronology. AgentRx results must therefore
be treated as diagnostic hypotheses and checked against the original logs.

## Safety

Neither workflow is allowed to commit source changes or merge pull requests.
Verify every diagnosis against the original artifact and reproduce it with a
focused regression test before changing validator or provider-fallback logic.
