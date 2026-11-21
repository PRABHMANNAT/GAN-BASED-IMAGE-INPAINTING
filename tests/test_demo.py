import io

import numpy as np
import pytest
from PIL import Image

from app import app
from inpainting import (baseline, conditioning, png_bytes, prepare_mask, scores,
                        synthetic_image, visible_edges)


@pytest.fixture
def client():
    app.config.update(TESTING=True)
    return app.test_client()


def payload(method="telea", reference="true", mask=None):
    rgb = synthetic_image(100, 64)
    if mask is None:
        mask = np.zeros((64, 64), np.uint8)
        mask[20:32, 25:32] = 255
    return {"image": (io.BytesIO(png_bytes(rgb)), "input.png"),
            "mask": (io.BytesIO(png_bytes(mask)), "mask.png"),
            "method": method, "clean_reference": reference}


def test_no_hidden_target_leakage():
    rgb = synthetic_image(1, 64)
    mask = np.zeros((64, 64), np.uint8)
    mask[15:40, 20:30] = 1
    changed = rgb.copy()
    changed[mask == 1] = (255, 0, 220)
    np.testing.assert_array_equal(conditioning(rgb, mask), conditioning(changed, mask))
    np.testing.assert_array_equal(visible_edges(rgb, mask), visible_edges(changed, mask))


def test_composite_preserves_visible_pixels():
    rgb = synthetic_image(2, 64)
    mask = np.zeros((64, 64), np.uint8)
    mask[10:40, 20:23] = 1
    restored = baseline(rgb, mask)
    np.testing.assert_array_equal(rgb[mask == 0], restored[mask == 0])


def test_metrics_analytic():
    reference = np.full((10, 10, 3), 100, np.uint8)
    restored = reference.copy(); restored[0:5] += 51
    mask = np.zeros((10, 10), np.uint8); mask[0:5] = 1
    assert scores(reference, restored, mask)["masked_psnr_db"] == 13.98
    assert scores(reference, reference, mask)["psnr_db"] is None


def test_mask_validation():
    with pytest.raises(ValueError, match="first"):
        prepare_mask(np.zeros((64, 64)), (64, 64, 3))
    with pytest.raises(ValueError, match="60%"):
        prepare_mask(np.full((64, 64), 255), (64, 64, 3))
    with pytest.raises(ValueError, match="dimensions"):
        prepare_mask(np.zeros((32, 32)), (64, 64, 3))


def test_api_baseline_and_provenance(client):
    assert client.get('/').status_code == 200
    assert client.get('/api/sample').mimetype == 'image/png'
    response = client.post('/api/inpaint', data=payload())
    assert response.status_code == 200
    result = response.get_json()
    assert result['restored'].startswith('data:image/png;base64,')
    assert result['metadata']['visible_pixels_preserved']
    assert result['metadata']['metrics']['masked_psnr_db'] is not None
    assert len(result['metadata']['source_sha256']) == 64


def test_no_reference_no_scores(client):
    response = client.post('/api/inpaint', data=payload(reference='false'))
    assert response.status_code == 200
    assert response.get_json()['metadata']['metrics'] is None


@pytest.mark.parametrize('data', [payload(mask=np.zeros((64,64),np.uint8)), payload(method='invalid')])
def test_invalid_requests(client, data):
    response = client.post('/api/inpaint', data=data)
    assert response.status_code == 400
    assert 'error' in response.get_json()


def test_bad_file(client):
    response = client.post('/api/prepare', data={'image': (io.BytesIO(b'not an image'), 'x.png')})
    assert response.status_code == 400


def test_gan_checkpoint_and_hidden_target_invariance(client):
    from model import load_generator, restore_gan
    model, provenance = load_generator()
    assert provenance['selected_step'] > 0
    rgb = synthetic_image(99, 64)
    mask = np.zeros((64,64),np.uint8); mask[16:32,20:30] = 1
    result, _ = restore_gan(rgb,mask)
    np.testing.assert_array_equal(result[mask==0],rgb[mask==0])
    changed = rgb.copy(); changed[mask==1] = 255
    again, _ = restore_gan(changed,mask)
    np.testing.assert_array_equal(result,again)
    assert client.post('/api/inpaint',data=payload(method='gan')).status_code == 200


def test_prepare_resizes_and_orients(client):
    raw = Image.new('RGB',(1200,600),'orange')
    stream=io.BytesIO();raw.save(stream,format='PNG');stream.seek(0)
    response=client.post('/api/prepare',data={'image':(stream,'large.png')})
    assert response.status_code == 200
    assert response.get_json()['width']==1024
    assert response.get_json()['height']==512


def test_missing_checkpoint_is_not_silently_replaced(client, monkeypatch, tmp_path):
    import model
    model.load_generator.cache_clear()
    monkeypatch.setattr(model,'CHECKPOINT',tmp_path/'absent.pt')
    try:
        assert client.get('/api/status').get_json()['gan_available'] is False
        response=client.post('/api/inpaint',data=payload(method='gan'))
        assert response.status_code==503
    finally:
        model.load_generator.cache_clear()
