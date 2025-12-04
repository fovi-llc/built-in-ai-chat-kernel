#!/bin/bash
# build.sh - Helper script to sync npm dependencies with installed JupyterLab/JupyterLite versions
# This is useful during development to ensure compatible package versions

set -e

# Get installed Python package versions
JLAB_VER=$(pip show jupyterlab | grep Version | awk '{print $2}')
JLITE_VER=$(pip show jupyterlite-core | grep Version | awk '{print $2}')

echo "Syncing to: JupyterLab $JLAB_VER, JupyterLite $JLITE_VER"

# Install the main packages with exact matching versions
npm install @jupyterlite/kernel@$JLITE_VER @jupyterlab/application@$JLAB_VER

# Resolve compatible versions for coreutils and services
# We query the npm registry to see what version of coreutils/services
# is required by the specific version of @jupyterlab/application we just identified.
CORE_REQ=$(npm view @jupyterlab/application@$JLAB_VER dependencies.@jupyterlab/coreutils)
SERV_REQ=$(npm view @jupyterlab/application@$JLAB_VER dependencies.@jupyterlab/services)

# Install the resolved versions
npm install @jupyterlab/coreutils@"$CORE_REQ" @jupyterlab/services@"$SERV_REQ"

echo "Dependencies synced successfully"
