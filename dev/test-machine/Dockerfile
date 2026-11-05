# Disposable Ubuntu "server" with real systemd, for testing Configuratix machine
# management locally (install one-liner, jobs, nginx apply/rollback, UFW, terminal, updates).
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive container=docker

RUN apt-get update \
 && apt-get install -y --no-install-recommends systemd systemd-sysv dbus sudo curl ca-certificates \
      iproute2 iptables procps less nano \
 && apt-get clean && rm -rf /var/lib/apt/lists/* \
 # Units that make no sense (or hang) inside a container
 && systemctl mask systemd-udevd.service systemd-udevd-kernel.socket systemd-udevd-control.socket \
      systemd-modules-load.service sys-kernel-debug.mount sys-kernel-tracing.mount getty.target \
      console-getty.service systemd-firstboot.service

STOPSIGNAL SIGRTMIN+3
CMD ["/sbin/init"]
