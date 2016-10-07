var VIZABI_MODEL = { 
  state: {
    entities: {
      dim: "geo"
    },
    entities_minimap: {
      dim: "geo",
      show: {
        "is--world_4region": true
      }
    },
    entities_tags: {
      dim: "tag"
    },
    time: {
      value: "2015"
    },
    marker: {
      space: ["entities", "time"],
      axis_y: {
        use: "indicator",
        which: "life_expectancy_years",
        zoomedMin: 19,
        domainMax: 85,
        domainMin: 0
      },
      axis_x: {
        use: "indicator",
        scaleType: "log",
        domainMax: 150000,
        domainMin: 300,
        which: "income_per_person_gdppercapita_ppp_inflation_adjusted"
      },
      size: {
        use: "indicator",
        which: "population_total",
        allow: {
          scales: ["linear"]
        },
        extent: [0, 0.85]
      },
      color: {
        use: "property",
        which: "world_4region"
      }
    },
    marker_minimap:{
      space: ["entities_minimap"],
      label: {
        use: "property",
        which: "name"
      },
      geoshape: {
        use: "property",
        which: "shape_lores_svg"
      }
    },
    marker_tags: {
      space: ["entities_tags"],
      label: {
        use: "property",
        which: "name"
      },
      parent: {
        use: "property",
        which: "parent"
      }
    }
  }
}