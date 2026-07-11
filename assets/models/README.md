# Models

This folder stores machine-learning model artifacts used by the app.

The chessboard detection ONNX model belongs here because it is loaded by the main-process board detection pipeline. Keep large model binaries out of source folders so runtime code can reference them as packaged assets.
