# jsPsychTrolleyProblem - Younes Strittmatter

Show a trolley problem to the participant. The participant has to decide whether to flip a switch to divert a trolley from a main track to a side track. The main track has a number of people on it, and the side track has a different number of people on it. The participant has to decide whether to flip the switch or not. When the participant flips the switch, the trolley will hit the people on the side track, but not the people on the main track. If the participant does not flip the switch, the trolley will hit the people on the main track, but not the people on the side track.

## Parameters

| Name          | Type     | Default       | Description |
|---------------|----------|---------------|-------------|
| main_track | COMPLEX | [{gender: "male", body_type: "business", skin: "white"}] | A list of objects that describe the people on the main track. |
| side_track | STRING | [{gender: "male", body_type: "business", skin: "white"}] | A list of objects that describe the people on the side track. |
| trial_duration | INT | null | The duration in ms the problem is show. If `null`, the problem is shown indefinitely |
| show_prompt | BOOL | true | Show a text explaining the problem. |


## Data Output

| Name         | Type     | Description |
|--------------|----------|-------------|
| action | STRING | Which action has been taken? `flip` the lever or do `nothing`. |
| choice | STRING | The choice (main_track or side_track) |
| rt | INT | The response time in milliseconds for the participant to make a response. |
| main_track | COMPLEX | A list of objects describing the people on the main_track. |
| side_track | COMPLEX | A list of objects describing the people on the side_track. |

## Loading

### In browser

```js
<script src="https://unpkg.com/@sweet-jspsych/plugin-trolley-problem@0.0.5"></script>
```

### Via NPM

```
npm install @sweet-jspsych/plugin-trolley-problem
```

```js
import jsPsychTrolleyProblem from '@sweet-jspsych/plugin-trolley-problem';
```

## Compatibility

jsPsych 7.0.0


## Options for Characters

- gender: Male, Female
- body_type: business, casual, pregnant, elderly
- skin: white, black, brown, alien

## Contribute Assets

You can contribute assets (characters or scenarios) here:

[Figure Lab](https://github.com/younesStrittmatter/figure-lab)




## Examples

```html
<!DOCTYPE html>
<html>

<head>
  <script src="https://unpkg.com/jspsych"></script>
  <script src="https://unpkg.com/@sweet-jspsych/plugin-trolley-problem"></script>
  <link rel="stylesheet" href="https://unpkg.com/jspsych@7.0.0/css/jspsych.css">
</head>

<body></body>
<script type="module">
  const jsPsych = initJsPsych({
    on_finish: function () {
      jsPsych.data.displayData();
    }
  });

  const trial = {
    type: jsPsychTrolleyProblem,
    main_track: [{ gender: "male", body_type: "business", skin: "white" }],
    side_track: [{ gender: 'female', body_type: 'pregnant', skin: 'black'
    }]
  };

  const trial_2 = {
    type: jsPsychTrolleyProblem,
    main_track: [{ gender: "female", body_type: "casual", skin: "white" }, {gender: "female", body_type: "elderly", skin: "brown"}],
    side_track: [{ gender: 'female', body_type: 'pregnant', skin: 'black'
    }]
  };

  jsPsych.run([trial, trial_2])
</script>

</html>
```