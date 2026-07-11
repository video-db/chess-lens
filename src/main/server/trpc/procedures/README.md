# tRPC Procedures

This folder contains the individual tRPC procedure groups exposed by the local main-process API.

Each file owns a domain of renderer-accessible operations, such as auth, capture, recordings, settings, transcription, visual index, and meeting setup. Procedures should validate inputs and delegate business logic to services.
