#!/bin/sh
# Behaves like ssh for connector tests: drops the host argument, joins
# the rest with spaces and runs it through a shell, as sshd would.
shift
exec sh -c "$*"
