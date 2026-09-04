# Intentionally insecure SYNTHETIC fixture for the Stage 5 scanner suite
# (see README.md). The URL host is example.invalid (RFC 2606, unroutable);
# nothing here is ever fetched or executed.

FROM ubuntu:latest

RUN apt-get update && apt-get install -y ca-certificates curl wget

RUN curl -fsSL http://updates.example.invalid/install.sh | bash

EXPOSE 22

CMD ["bash"]
