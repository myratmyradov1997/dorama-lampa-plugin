import unittest
from unittest.mock import patch

import server


class FakeResponse:
    def __init__(self, content=b'', status_code=200, headers=None, chunks=None):
        self.content = content
        self.status_code = status_code
        self.headers = headers or {}
        self._chunks = chunks if chunks is not None else [content]
        self.closed = False

    def raise_for_status(self):
        if self.status_code >= 400:
            raise server.requests.HTTPError(f'HTTP {self.status_code}')

    def iter_content(self, chunk_size=1):
        yield from self._chunks

    def close(self):
        self.closed = True


class InterruptedResponse(FakeResponse):
    def iter_content(self, chunk_size=1):
        yield b'abc'
        raise server.requests.ConnectionError('simulated upstream disconnect')


class VideoProxyTests(unittest.TestCase):
    def setUp(self):
        server.app.config.update(TESTING=True)
        self.client = server.app.test_client()

    def test_video_allowlist_rejects_ssrf_targets(self):
        self.assertTrue(server.is_allowed_video_url('https://vd478.okcdn.ru/video.mp4'))
        self.assertTrue(server.is_allowed_video_url('https://ok6-3.vkuser.net/video.mp4'))
        self.assertTrue(server.is_allowed_video_url('https://cdn.mycdn.me/segment.ts'))
        self.assertFalse(server.is_allowed_video_url('http://127.0.0.1:8000/private'))
        self.assertFalse(server.is_allowed_video_url('https://okcdn.ru.evil.example/video.mp4'))
        self.assertFalse(server.is_allowed_video_url('https://vkuser.net.evil.example/video.mp4'))
        self.assertFalse(server.is_allowed_video_url('file:///etc/passwd'))

    def test_hls_manifest_rewrites_relative_segments_and_keys(self):
        manifest = (
            '#EXTM3U\n'
            '#EXT-X-KEY:METHOD=AES-128,URI="keys/key.bin"\n'
            '#EXTINF:4,\n'
            'segments/one.ts\n'
        )
        with server.app.test_request_context('/'):
            rewritten = server.rewrite_hls_manifest(
                manifest,
                'https://vd478.okcdn.ru/path/master.m3u8',
            )

        self.assertIn('/api/doramyclub/proxy?url=', rewritten)
        self.assertIn('https%3A%2F%2Fvd478.okcdn.ru%2Fpath%2Fsegments%2Fone.ts', rewritten)
        self.assertIn('https%3A%2F%2Fvd478.okcdn.ru%2Fpath%2Fkeys%2Fkey.bin', rewritten)

    @patch('server.requests.get')
    def test_proxy_returns_rewritten_hls(self, mocked_get):
        mocked_get.return_value = FakeResponse(
            b'#EXTM3U\n#EXTINF:4,\nsegment.ts\n',
            headers={'Content-Type': 'application/vnd.apple.mpegurl'},
        )
        response = self.client.get(
            '/api/doramyclub/proxy',
            query_string={'url': 'https://vd478.okcdn.ru/a/master.m3u8'},
        )

        self.assertEqual(response.status_code, 200)
        self.assertIn(b'/api/doramyclub/proxy?url=', response.data)
        self.assertEqual(response.headers['Cache-Control'], 'no-store, no-cache, must-revalidate')

    @patch('server.requests.get')
    def test_proxy_forwards_range_headers_and_streams_body(self, mocked_get):
        mocked_get.return_value = FakeResponse(
            status_code=206,
            headers={
                'Content-Type': 'video/mp4',
                'Content-Length': '6',
                'Content-Range': 'bytes 10-15/100',
                'Accept-Ranges': 'bytes',
            },
            chunks=[b'abc', b'def'],
        )
        response = self.client.get(
            '/api/doramyclub/proxy',
            query_string={'url': 'https://vd478.okcdn.ru/a/video.mp4'},
            headers={'Range': 'bytes=10-'},
        )

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response.data, b'abcdef')
        self.assertEqual(response.headers['Content-Range'], 'bytes 10-15/100')
        self.assertEqual(mocked_get.call_args.kwargs['headers']['Range'], 'bytes=10-')

    @patch('server.requests.get')
    def test_proxy_resumes_after_upstream_disconnect(self, mocked_get):
        mocked_get.side_effect = [
            InterruptedResponse(
                status_code=200,
                headers={'Content-Type': 'video/mp4', 'Content-Length': '6'},
            ),
            FakeResponse(
                status_code=206,
                headers={
                    'Content-Type': 'video/mp4',
                    'Content-Length': '3',
                    'Content-Range': 'bytes 3-5/6',
                },
                chunks=[b'def'],
            ),
        ]
        response = self.client.get(
            '/api/doramyclub/proxy',
            query_string={'url': 'https://vd478.okcdn.ru/a/video.mp4'},
        )

        self.assertEqual(response.data, b'abcdef')
        self.assertEqual(mocked_get.call_count, 2)
        self.assertEqual(mocked_get.call_args_list[1].kwargs['headers']['Range'], 'bytes=3-')

    def test_proxy_rejects_unknown_host_without_fetching(self):
        response = self.client.get(
            '/api/doramyclub/proxy',
            query_string={'url': 'https://example.com/video.mp4'},
        )
        self.assertEqual(response.status_code, 403)

    @patch('server.requests.get')
    def test_proxy_rejects_redirect_outside_allowlist(self, mocked_get):
        mocked_get.return_value = FakeResponse(
            status_code=302,
            headers={'Location': 'http://127.0.0.1:8000/private'},
        )
        response = self.client.get(
            '/api/doramyclub/proxy',
            query_string={'url': 'https://vd478.okcdn.ru/redirect'},
        )
        self.assertEqual(response.status_code, 502)
        self.assertEqual(mocked_get.call_count, 1)


if __name__ == '__main__':
    unittest.main()
