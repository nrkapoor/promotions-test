# Hero V2 Block

The **Hero V2** block is a flexible and visually impactful section designed to feature prominent images, compelling titles, subtitles, descriptions, and an optional call-to-action button.

## Features

- Responsive layout with image and overlaying content.
- Customizable fields for:
  - Image and alternative text
  - Title (h2)
  - Subtitle (h3)
  - Description
  - CTA label and URL
- Optimized image rendering
- Modern styling with absolute-positioned content areas

## Structure

The Hero V2 block expects the following structure:

```html
<div class="hero-v2">
  <div class="hero-v2-main">
    <div class="hero-v2-content">
      <div class="hero-v2-image">
        <picture>
          <img src="..." alt="..." />
        </picture>
      </div>
      <div class="hero-v2-body">
        <h2>Title Text</h2>
        <h3>Subtitle Text</h3>
        <p>Description text goes here</p>
        <p class="button-container">
          <a href="..." class="button">CTA Label</a>
        </p>
      </div>
    </div>
  </div>
</div>
```

## Editing

- **Image/Alt**: The main visual; appears as the background.
- **Title**: Large heading, positioned at the top.
- **Subtitle**: Secondary heading, smaller, aligned below or beside the title.
- **Description**: Supporting text, positioned mid-block.
- **CTA**: Optional button, positioned toward the bottom right.

You can configure content in the `.json` model definition (`_hero-v2.json`).

## Styling

Styles can be customized through `hero-v2.css`. The block is responsive and designed to look great across different device sizes.

- Uses CSS variables for colors and dimensions.
- Content overlays the hero image.

## Usage

1. Add or configure the Hero V2 block in your section.
2. Provide image, alt text, title, subtitle, description, and (optionally) CTA label and URL.
3. Customize styles in `hero-v2.css` if required.

## Example

```markdown
| Image          | Title         | Subtitle      | Description       | CTA Label | CTA URL        |
|----------------|---------------|---------------|-------------------|-----------|----------------|
| /img/example.jpg | Welcome      | To Our Site   | Discover more...  | Learn More| /learn-more    |
```

## Notes

- The image is optimized automatically.
- This block is best used at the top of a landing or product page to grab user attention.

For more details, review the block's JS, CSS, and JSON files.
