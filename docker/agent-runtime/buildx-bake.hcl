group "default" {
  targets = ["base", "claude", "codex"]
}

variable "VERSION" { default = "dev" }
variable "REGISTRY" { default = "ghcr.io/fortedexe" }

target "base" {
  context = "."
  dockerfile = "docker/agent-runtime/Dockerfile.base"
  platforms = ["linux/amd64"]
  tags = ["${REGISTRY}/agent-runtime-base:${VERSION}"]
}

target "claude" {
  context = "."
  dockerfile = "docker/agent-runtime/Dockerfile.claude"
  platforms = ["linux/amd64"]
  tags = ["${REGISTRY}/agent-runtime-claude:${VERSION}"]
  args = {
    BASE_TAG = "${VERSION}"
  }
  contexts = {
    "fortedexe/agent-runtime-base:${VERSION}" = "target:base"
  }
}

target "codex" {
  context = "."
  dockerfile = "docker/agent-runtime/Dockerfile.codex"
  platforms = ["linux/amd64"]
  tags = ["${REGISTRY}/agent-runtime-codex:${VERSION}"]
  args = {
    BASE_TAG = "${VERSION}"
  }
  contexts = {
    "fortedexe/agent-runtime-base:${VERSION}" = "target:base"
  }
}
