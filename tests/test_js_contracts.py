import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]


class JavaScriptContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = (ROOT / 'lampa-plugin.js').read_text(encoding='utf-8')
        cls.online = (ROOT / 'dorama-online.js').read_text(encoding='utf-8')

    def test_search_uses_official_lampa_input_parameter(self):
        self.assertIn('Lampa.Search.open({', self.catalog)
        self.assertIn('input: query', self.catalog)
        self.assertNotIn('query: query', self.catalog)
        self.assertNotIn('new KeyboardEvent', self.catalog)

    def test_remote_navigation_does_not_capture_global_keydown(self):
        self.assertNotIn("addEventListener('keydown'", self.catalog)
        self.assertIn("Lampa.Controller.toggle('content')", self.catalog)
        self.assertIn(".on('hover:enter click'", self.catalog)
        self.assertNotIn(".off('hover:enter click',", self.catalog)
        self.assertNotIn(".off('hover:enter click',", self.online)

    def test_online_module_load_has_retry_and_readiness_gate(self):
        self.assertIn('function loadOnlinePlugin', self.catalog)
        self.assertIn('window.dorama_online_plugin', self.catalog)
        self.assertIn('function openOnlineCard', self.catalog)

    def test_player_prefers_mp4_and_registers_mp4_recovery_callback(self):
        self.assertIn('var primaryUrl = proxyUrl(best.url)', self.online)
        self.assertNotIn('streamData.hls ? proxyUrl(streamData.hls)', self.online)
        self.assertNotIn('renewed = proxyUrl(fresh.hls)', self.online)
        self.assertIn('element.error = function', self.online)
        self.assertIn('work.quality_switched', self.online)

    def test_online_module_cachebuster_matches_release(self):
        self.assertIn("/online.js?v=2.0.2", self.catalog)


if __name__ == '__main__':
    unittest.main()
