from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parents[1]

def luminance(hex_color):
    rgb=[int(hex_color[i:i+2],16)/255 for i in (1,3,5)]
    rgb=[c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4 for c in rgb]
    return sum(c*w for c,w in zip(rgb,(0.2126,0.7152,0.0722)))

def contrast(a,b):
    hi,lo=sorted((luminance(a),luminance(b)),reverse=True)
    return (hi+0.05)/(lo+0.05)

def tactile_css():
    return (ROOT/'static/tactile.css').read_text(encoding='utf-8')+'\n'+(ROOT/'static/brand-palette.css').read_text(encoding='utf-8')

def css_property(selector, property_name):
    """Read the final declaration for an exact selected-material selector."""
    css=re.sub(r'/\*.*?\*/','',tactile_css(),flags=re.S)
    value=None
    for selectors, declarations in re.findall(r'([^{}]+)\{([^{}]*)\}',css):
        if selector not in [part.strip() for part in selectors.split(',')]: continue
        for declaration in declarations.split(';'):
            if ':' not in declaration: continue
            name, candidate=declaration.split(':',1)
            if name.strip()==property_name:
                value=candidate.replace('!important','').strip()
    if value is None: raise AssertionError(f'Missing {property_name} for {selector}')
    return value

class AccessibilityContractTests(unittest.TestCase):
    def test_selected_text_pairs_exceed_aa(self):
        # The lightest relevant final material endpoints test light foregrounds.
        # These are UI palette contracts, not a full browser accessibility audit.
        for selector,bg in [('.cell-sub','#292f16'),('th','#303519'),('.practice-disclosure','#292f15'),('.engraved-label','#4b4a22'),('.desk-rule','#4b4a22'),('.button.primary','#c12a12'),('.button.secondary','#4b4e2a'),('.balance','#4c512b'),('.balance.vip','#6c4b18'),('.balance.vvip','#6a231a'),('.quantity-grid label small','#6a231a'),('input::placeholder','#1d220c'),('.recovery-alert','#543e0c'),('.flow-steps span.active','#292f16'),('.icon-button','#4d4b29'),('.register-heading h2>span','#4b4a22')]:
            fg=css_property(selector,'color')
            with self.subTest(selector=selector,fg=fg,bg=bg): self.assertGreaterEqual(contrast(fg,bg),4.5)
    def test_form_boundary_contrast(self):
        for selector,bg in [('label>input:not([type=checkbox])','#1b200a'),('.search-wrap','#1d220c')]:
            with self.subTest(selector=selector): self.assertGreaterEqual(contrast(css_property(selector,'border-color'),bg),3)
    def test_dark_visible_focus_and_reduced_motion(self):
        css=tactile_css()
        self.assertIn('outline:3px solid #dfb66f',css)
        self.assertEqual(css_property('dialog button:focus-visible','outline-color'),'#EAA80B')
        self.assertIn('prefers-reduced-motion:reduce',css)
        self.assertIn('forced-colors:active',css)
    def test_keyboard_navigation_and_live_completion(self):
        js=(ROOT/'static/app.js').read_text(); html=(ROOT/'static/index.html').read_text()
        self.assertIn("['ArrowLeft','ArrowRight','Home','End']",js)
        self.assertIn('role="status" aria-live="polite"',js)
        self.assertIn('role="region" aria-label="Deposit results, scroll horizontally for all columns" tabindex="0"',html)
    def test_no_remote_resources_in_static_html(self):
        html=(ROOT/'static/index.html').read_text()
        self.assertNotIn('src="https:',html); self.assertNotIn('href="https:',html)

if __name__=='__main__': unittest.main()
