# Sandbox jobs: a separate, spend-limited provider key (threat model T11, T17). No access to the API's key.
path "gaik/data/deployments/local/sandbox" {
  capabilities = ["read"]
}
