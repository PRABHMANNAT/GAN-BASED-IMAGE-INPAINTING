"""Export the trained educational generator; verify ONNX/PyTorch parity."""
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

from model import load_generator

def main():
    model, provenance = load_generator()
    folder = Path(__file__).parent / 'web/public/models'
    folder.mkdir(parents=True, exist_ok=True)
    filename = folder / 'edge-unet.onnx'
    rng = np.random.default_rng(2026)
    tensor = rng.random((1, 5, 256, 256), dtype=np.float32)
    torch.onnx.export(model, (torch.from_numpy(tensor),), filename, input_names=['condition'],
                      output_names=['prediction'], opset_version=17, dynamo=False)
    onnx.checker.check_model(str(filename))
    runtime = ort.InferenceSession(str(filename), providers=['CPUExecutionProvider'])
    with torch.inference_mode():
        expected = model(torch.from_numpy(tensor)).numpy()
    actual = runtime.run(None, {'condition': tensor})[0]
    error = float(np.abs(expected-actual).max())
    assert error < 1e-4, error
    (folder/'provenance.json').write_text(json.dumps({**provenance, 'onnx_opset':17,
        'export_max_absolute_error':error, 'input_shape':[1,5,256,256]},indent=2),encoding='utf-8')
    print(f'Exported {filename}; maximum absolute parity error {error:.8f}')

if __name__ == '__main__':
    main()
