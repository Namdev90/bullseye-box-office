from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

def luminance(hex_color):
    rgb=[int(hex_color[i:i+2],16)/255 for i in (1,3,5)]
    rgb=[c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4 for c in rgb]
    return sum(c*w for c,w in zip(rgb,(0.2126,0.7152,0.0722)))

def contrast(a,b):
    hi,lo=sorted((luminance(a),luminance(b)),reverse=True)
    return (hi+0.05)/(lo+0.05)

class AccessibilityContractTests(unittest.TestCase):
    def test_selected_text_pairs_exceed_aa(self):
        for fg,bg in [('#62656a','#f7f7f6'),('#62656a','#ededeb'),('#265b42','#e9f0e7'),('#765314','#f4ecda'),('#963323','#fbeee9'),('#ffffff','#191a1b')]:
            with self.subTest(fg=fg,bg=bg): self.assertGreaterEqual(contrast(fg,bg),4.5)
    def test_form_boundary_contrast(self):
        self.assertGreaterEqual(contrast('#7c8085','#ededeb'),3)
    def test_dark_visible_focus_and_reduced_motion(self):
        css=(ROOT/'static/style.css').read_text()
        self.assertIn('outline: 3px solid #191a1b',css)
        self.assertIn('prefers-reduced-motion: reduce',css)
        self.assertIn('forced-colors: active',css)
    def test_keyboard_navigation_and_live_completion(self):
        js=(ROOT/'static/app.js').read_text(); html=(ROOT/'static/index.html').read_text()
        self.assertIn("['ArrowLeft','ArrowRight','Home','End']",js)
        self.assertIn('role="status" aria-live="polite"',js)
        self.assertIn('role="region" aria-label="Deposit results, scroll horizontally for all columns" tabindex="0"',html)
    def test_no_remote_resources_in_static_html(self):
        html=(ROOT/'static/index.html').read_text()
        self.assertNotIn('src="https:',html); self.assertNotIn('href="https:',html)

if __name__=='__main__': unittest.main()
