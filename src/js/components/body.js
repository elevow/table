import React from 'react';

export default class Body extends React.Component {
    constructor() {
        super();
        this.state = {
            counter: 0,
        };
    }
    
    render() {
        return (
<div class="container">
    <div class="jumbotron">
        <h1>Welcome to the Table!</h1>
        <p>This is a simple hero unit, a simple jumbotron-style component for calling extra attention to featured content or
            information.</p>
        <p><a class="btn btn-primary btn-lg">Learn more</a></p>
    </div>
</div>
        );
    }
}
