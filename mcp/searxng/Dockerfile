FROM docker.io/searxng/searxng@sha256:44076b281d6c6ad9e258b213b832aa1d77a728ec0b8319d21d3e271f12bf1746

COPY bootstrap-secret.sh /usr/local/searxng/bootstrap-secret.sh
RUN chmod 0755 /usr/local/searxng/bootstrap-secret.sh

# Reliability Major-1: a root-owned searxng-secret volume makes the
# non-root entrypoint fail closed (chmod/mkdir EPERM -> exit 1 crash loop).
# Pre-create the directory and hand it to searxng at build time so fresh
# named volumes inherit searxng ownership on initialization.
RUN mkdir -p /var/lib/searxng-secret && chown searxng:searxng /var/lib/searxng-secret

USER searxng

# Note: the entrypoint runs as searxng (non-root) and cannot chown a
# root-owned mount at runtime; bootstrap-secret.sh therefore fails closed
# with a clear error instead of silently continuing. Ownership must be
# fixed here at build time; verify against a live volume with a compose
# up-cycle.
ENTRYPOINT ["/usr/local/searxng/bootstrap-secret.sh"]
