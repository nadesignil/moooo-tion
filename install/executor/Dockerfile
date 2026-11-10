FROM python:3.12-slim-bookworm
RUN sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends ffmpeg fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir numpy==2.2.6 Pillow==11.2.1 opencv-python-headless==4.11.0.86 scipy==1.15.3
RUN groupadd -g 1000 worker && useradd -u 1000 -g 1000 -M worker \
    && mkdir /input /output && chown worker:worker /output
USER 1000:1000
WORKDIR /output
CMD ["python", "-I", "-"]
