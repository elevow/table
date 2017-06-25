import React from 'react';
import Footer from '../components/footer';
import Header from '../components/header';
import Math from '../utils/math';

export default class Game extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            playerA: '',
            playerB: '',
        }

        this.draw = this.draw.bind(this);
    }

    draw() {
        let valueA = Math.randomInt(11, 1);
        let valueB = Math.randomInt(11, 1);
        this.setState({playerA: valueA});
        this.setState({playerB: valueB});
    }

    render() {
        return (
            <div>
            <Header/>
            <h1>Game</h1>
            <button onClick={this.draw} type="button" class="btn btn-primary">Deal!</button>
            <p>Player A: {this.state.playerA}</p>
            <p>Player B: {this.state.playerB}</p>
            <Footer/>
            </div>
        );
    }
}