#!/bin/bash

tsc --noEmit && \
    tsc --noEmit --project worker/tsconfig.json && \
    vite build && \
    wrangler deploy
