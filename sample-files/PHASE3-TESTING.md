# Phase 3 choropleth testing

## Basic test

1. Drop `test-data/phase3-wisconsin-sample.geojson` onto the map.
2. Open **Layers**, expand the imported layer, and select **Choropleth**.
3. Choose `rate`, `population`, or `category_code` as the numeric field.
4. Try **Quantile**, **Equal interval**, and **Natural breaks (Jenks)**.
5. Change the class count, ramp, reverse setting, opacity, and outline.
6. Confirm the map legend changes with the classes.
7. Save and reopen the map, then open its published viewer link.

## Skewed-value test

Use `test-data/phase3-skewed-values.geojson` and classify the `value` field.
The deliberately uneven distribution makes the differences between the three
classification methods easy to see.

## Editing behavior

Choropleth mode is a rendered thematic view. Switch the layer back to
**Symbols** before selecting or editing individual polygons.

## Normalization test

Use `test-data/phase3-normalization-sample.geojson` and map `cases`.

- Divide by `population` and try rates per 1,000 and 100,000.
- Use percent of layer total.
- Use density per square kilometer and per square mile.
- Use z-scores and confirm the diverging ramp is selected.
- Two features intentionally contain a zero or missing population. When
  `population` is the denominator, the interface should report those features
  as excluded and draw them with the no-data color.
