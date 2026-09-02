FROM docker.io/searxng/searxng@sha256:44076b281d6c6ad9e258b213b832aa1d77a728ec0b8319d21d3e271f12bf1746

COPY bootstrap-secret.sh /usr/local/searxng/bootstrap-secret.sh
RUN chmod 0755 /usr/local/searxng/bootstrap-secret.sh

ENTRYPOINT ["/usr/local/searxng/bootstrap-secret.sh"]
